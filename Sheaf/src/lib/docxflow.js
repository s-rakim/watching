// PDF page contents -> an editable Word document or PowerPoint deck.
//
// The same file is used by Sheaf (browser, pdf.js reads the PDF) and Sheaf-D (server,
// PyMuPDF reads it). Keep the two copies identical. It has no imports, so it runs in both.
//
// Input, per page, everything in points from the top-left corner of the page as shown:
//   { w, h,
//     texts:  [{ str, x, w, base, size, font, kind, bold, italic, color, link }],
//     rects:  [{ x, y, w, h, fill, stroke, lw, round }]   fill/stroke are 'RRGGBB' or null
//     lines:  [{ x1, y1, x2, y2, color, lw }]              straight stroked lines
//     shapes: [{ x, y, w, h }]                             anything curved or slanted
//     images: [{ x, y, w, h, id, faint }] }                id is a key into `media`
// media: { [id]: { bytes: Uint8Array, ext: 'png' | 'jpeg' } }
// renderRegion(pageIndex, { x, y, w, h }) -> Promise<Uint8Array PNG>, used for charts and
// other drawings that Word has no editable equivalent for.
//
// What comes out is ordinary Word content that flows: real tables with their borders and
// shading, boxes as one-cell tables, rules as paragraph borders, pictures in line with the
// text, and text as paragraphs that reflow. Nothing is a picture of the page.

const tw = (pt) => Math.max(0, Math.round(pt * 20));
const emu = (pt) => Math.max(1, Math.round(pt * 12700));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const LTR = /[\p{L}\p{N}]/u;

const box = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h, r: o.x + o.w, b: o.y + o.h });
const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
const inside = (a, b, tol = 1.5) => a.x >= b.x - tol && a.r <= b.r + tol && a.y >= b.y - tol && a.b <= b.b + tol;
const union = (list) => {
  const x = Math.min(...list.map((b) => b.x)), y = Math.min(...list.map((b) => b.y));
  return box({ x, y, w: Math.max(...list.map((b) => b.r)) - x, h: Math.max(...list.map((b) => b.b)) - y });
};
const light = (hex) => {
  if (!hex) return true;
  const n = parseInt(hex, 16);
  return ((n >> 16) & 255) > 247 && ((n >> 8) & 255) > 247 && (n & 255) > 247;
};

// Helvetica/Arial widths (hundredths of an em) for ASCII, to guess how wide a line will be
// in Word, which usually swaps a missing font for Arial.
const W_REG = [28,28,36,56,56,89,67,19,33,33,39,58,28,33,28,28,56,56,56,56,56,56,56,56,56,56,28,28,58,58,58,56,102,67,67,72,72,67,61,78,72,28,50,67,56,83,72,78,67,78,72,67,61,72,67,94,67,67,61,28,28,28,47,56,33,56,56,50,56,56,28,56,56,22,22,50,22,83,56,56,56,56,33,50,28,56,50,72,50,50,50,33,26,33,58];
const W_BOLD = [28,33,47,56,56,89,72,24,33,33,39,58,28,33,28,28,56,56,56,56,56,56,56,56,56,56,33,33,58,58,58,61,98,72,72,72,72,67,61,78,72,28,56,72,61,83,72,78,67,78,72,67,61,72,67,94,67,67,61,33,28,33,58,56,33,56,61,56,61,56,33,61,61,28,28,56,28,89,61,61,61,61,39,56,33,61,56,78,56,56,50,39,28,39,58];
const guessWidth = (runs) => runs.reduce((w, r) => {
  const t = r.bold ? W_BOLD : W_REG;
  let n = 0;
  for (const ch of r.text) { const c = ch.codePointAt(0); n += c >= 32 && c < 127 ? t[c - 32] : 60; }
  return w + (n / 100) * r.size;
}, 0);

/* ---------------------------------------------------------------- reading the page */

/**
 * List bullets drawn as little circles or squares, not as text, become a "•" in front of
 * their line, so they stay with it when the text moves.
 */
function bulletsAsText(page) {
  const texts = [...page.texts];
  const small = (s) => s.w >= 1.5 && s.h >= 1.5 && s.w <= 8 && s.h <= 8 && s.w / s.h > 0.6 && s.w / s.h < 1.6;
  const marks = [...page.shapes, ...page.rects.filter((r) => r.fill && !r.stroke)].filter(small);
  const used = new Set();
  for (const m of marks) {
    const cy = m.y + m.h / 2;
    const next = page.texts.filter((t) => t.str.trim() && t.x > m.x + m.w && t.x - (m.x + m.w) < Math.max(20, t.size * 2.5)
      && cy < t.base && cy > t.base - t.size * 0.9).sort((a, b) => a.x - b.x)[0];
    if (!next) continue;
    used.add(m);
    texts.push({ ...next, str: '•', x: m.x, w: m.w });
    texts.push({ ...next, str: ' ', x: m.x + m.w, w: Math.max(0.5, next.x - m.x - m.w) });
  }
  return { ...page, texts, shapes: page.shapes.filter((s) => !used.has(s)), rects: page.rects.filter((r) => !used.has(r)) };
}

/** Thin rectangles are lines; Chrome and most report generators draw borders that way. */
function segmentsOf(page) {
  const segs = [], fills = [];
  const seg = (x1, y1, x2, y2, color, lw) => {
    if (Math.abs(y1 - y2) <= 0.5) segs.push({ dir: 'h', p: (y1 + y2) / 2, a: Math.min(x1, x2), z: Math.max(x1, x2), color, lw });
    else if (Math.abs(x1 - x2) <= 0.5) segs.push({ dir: 'v', p: (x1 + x2) / 2, a: Math.min(y1, y2), z: Math.max(y1, y2), color, lw });
    else return false;
    return true;
  };
  for (const r of page.rects) {
    if (r.w <= 0 && r.h <= 0) continue;
    const thin = Math.min(r.w, r.h);
    // a narrow strip (a coloured bar down the side of a card) is a line too, up to the
    // thickest border Word draws
    const bar = thin <= 6 && Math.max(r.w, r.h) >= thin * 10;
    if (r.fill && !r.stroke && (thin <= 2.5 || bar) && Math.max(r.w, r.h) > 4) {
      if (r.h <= r.w) seg(r.x, r.y + r.h / 2, r.x + r.w, r.y + r.h / 2, r.fill, Math.max(0.25, r.h));
      else seg(r.x + r.w / 2, r.y, r.x + r.w / 2, r.y + r.h, r.fill, Math.max(0.25, r.w));
      continue;
    }
    if (r.stroke && !r.round && r.w > 2 && r.h > 2) {
      seg(r.x, r.y, r.x + r.w, r.y, r.stroke, r.lw); seg(r.x, r.y + r.h, r.x + r.w, r.y + r.h, r.stroke, r.lw);
      seg(r.x, r.y, r.x, r.y + r.h, r.stroke, r.lw); seg(r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.stroke, r.lw);
      if (r.fill && !light(r.fill)) fills.push({ ...box(r), fill: r.fill });
      continue;
    }
    fills.push({ ...box(r), fill: r.fill, stroke: r.stroke, lw: r.lw, round: r.round });
  }
  const shapes = page.shapes.map(box);
  for (const l of page.lines) {
    if (!seg(l.x1, l.y1, l.x2, l.y2, l.color, l.lw)) {
      shapes.push(box({ x: Math.min(l.x1, l.x2), y: Math.min(l.y1, l.y2), w: Math.abs(l.x2 - l.x1), h: Math.abs(l.y2 - l.y1) }));
    }
  }
  // Join pieces of the same line that touch or overlap.
  const merged = [];
  for (const dir of ['h', 'v']) {
    const list = segs.filter((s) => s.dir === dir).sort((a, b) => a.p - b.p || a.a - b.a);
    for (const s of list) {
      const m = merged.find((t) => t.dir === dir && Math.abs(t.p - s.p) <= 1 && s.a <= t.z + 1.5 && s.z >= t.a - 1.5);
      if (m) { m.a = Math.min(m.a, s.a); m.z = Math.max(m.z, s.z); m.lw = Math.max(m.lw, s.lw); } else merged.push({ ...s });
    }
  }
  return { segs: merged, fills, shapes };
}

const segBox = (s) => (s.dir === 'h'
  ? box({ x: s.a, y: s.p - s.lw / 2, w: s.z - s.a, h: s.lw })
  : box({ x: s.p - s.lw / 2, y: s.a, w: s.lw, h: s.z - s.a }));

const cluster = (vals, tol) => {
  const out = [];
  for (const v of [...vals].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && v - last.max <= tol) { last.max = v; last.sum += v; last.n++; } else out.push({ max: v, sum: v, n: 1 });
  }
  return out.map((c) => c.sum / c.n);
};

/** Grids of crossing lines become tables. */
function findTables(segs, fills) {
  // connected groups of lines
  const groups = [];
  const touches = (a, b) => {
    const A = segBox(a), B = segBox(b);
    return A.x <= B.r + 2 && B.x <= A.r + 2 && A.y <= B.b + 2 && B.y <= A.b + 2;
  };
  const left = new Set(segs);
  for (const s of segs) {
    if (!left.has(s)) continue;
    left.delete(s);
    const g = [s];
    for (let i = 0; i < g.length; i++) for (const t of [...left]) if (touches(g[i], t)) { left.delete(t); g.push(t); }
    groups.push(g);
  }
  const tables = [];
  for (const g of groups) {
    const H = g.filter((s) => s.dir === 'h'), V = g.filter((s) => s.dir === 'v');
    if (H.length < 2 || V.length < 2) continue;
    // Rows and columns come from the lines, plus the ends of lines that run past the last
    // crossing one (a table whose bottom edge is the rounded box around it, for instance).
    const ys = cluster([...H.map((s) => s.p), ...V.map((s) => s.a), ...V.map((s) => s.z)], 2);
    const xs = cluster([...V.map((s) => s.p), ...H.map((s) => s.a), ...H.map((s) => s.z)], 2);
    if (ys.length < 2 || xs.length < 2) continue;
    const bb = box({ x: xs[0], y: ys[0], w: xs[xs.length - 1] - xs[0], h: ys[ys.length - 1] - ys[0] });
    if (bb.w < 20 || bb.h < 8) continue;
    const covers = (list, p, a, z) => list.find((s) => Math.abs(s.p - p) <= 2 && s.a <= a + 2 + (z - a) * 0.25 && s.z >= z - 2 - (z - a) * 0.25);
    const rows = ys.length - 1, cols = xs.length - 1;
    // cell owner map, merging where an inner line is missing
    const owner = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (owner[r][c]) continue;
        let c2 = c;
        while (c2 + 1 < cols && !covers(V, xs[c2 + 1], ys[r], ys[r + 1])) c2++;
        let r2 = r;
        while (r2 + 1 < rows && !covers(H, ys[r2 + 1], xs[c], xs[c2 + 1]) && owner[r2 + 1].slice(c, c2 + 1).every((o) => !o)) r2++;
        const cell = { row: r, col: c, row2: r2, col2: c2, ...box({ x: xs[c], y: ys[r], w: xs[c2 + 1] - xs[c], h: ys[r2 + 1] - ys[r] }) };
        const edge = (list, p, a, z) => { const s = covers(list, p, a, z); return s ? { color: s.color, lw: s.lw } : null; };
        cell.border = {
          top: edge(H, ys[r], xs[c], xs[c2 + 1]), bottom: edge(H, ys[r2 + 1], xs[c], xs[c2 + 1]),
          left: edge(V, xs[c], ys[r], ys[r2 + 1]), right: edge(V, xs[c2 + 1], ys[r], ys[r2 + 1]),
        };
        const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2;
        const shade = fills.filter((f) => f.fill && !light(f.fill) && cx >= f.x && cx <= f.r && cy >= f.y && cy <= f.b && inside(f, bb, 3))
          .sort((a, b) => area(a) - area(b))[0];
        cell.fill = shade?.fill || null;
        for (let i = r; i <= r2; i++) for (let j = c; j <= c2; j++) owner[i][j] = cell;
        cells.push(cell);
      }
    }
    tables.push({ kind: 'table', ...bb, xs, ys, cells, segs: g });
  }
  return tables;
}

/** Text pieces into lines, and lines into fragments wherever there is a column-sized gap. */
function textFragments(texts) {
  const lines = [];
  for (const t of [...texts].sort((a, b) => a.base - b.base || a.x - b.x)) {
    let line = lines.find((l) => Math.abs(l.base - t.base) < Math.min(l.size, t.size) * 0.35);
    if (!line) lines.push(line = { base: t.base, size: t.size, items: [] });
    line.items.push(t);
    line.size = Math.max(line.size, t.size);
  }
  const frags = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const t of line.items) {
      const blank = !t.str.trim();
      if (cur && !blank && t.x - cur.end > Math.max(cur.size, t.size) * 1.6) cur = null;
      if (blank) { if (cur) cur.space = true; continue; }
      if (!cur) frags.push(cur = { x: t.x, end: t.x + t.w, base: line.base, size: t.size, items: [] });
      cur.items.push({ ...t, spaceBefore: !!cur.space });
      cur.space = false;
      cur.end = Math.max(cur.end, t.x + t.w);
      cur.size = Math.max(cur.size, t.size);
    }
  }
  return frags.map((f) => {
    const runs = runsOf(f.items);
    return fragment(f.items, f.base, f.size);
  }).filter((f) => f.runs.length);
}

function fragment(items, base, size) {
  const x = Math.min(...items.map((t) => t.x)), end = Math.max(...items.map((t) => t.x + t.w));
  return { kind: 'text', ...box({ x, y: base - size * 0.92, w: end - x, h: size * 1.17 }), base, size, items, runs: runsOf(items), rtl: isRtl(items) };
}

/** Table cells: text is cut at cell edges, and pieces on one line in one cell are one line. */
function cellText(blocks, cells) {
  const out = new Map(cells.map((c) => [c, []]));
  const rest = [];
  for (const b of blocks) {
    if (b.kind !== 'text') {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const cell = cells.find((c) => cx >= c.x && cx <= c.r && cy >= c.y && cy <= c.b) || cells.find((c) => inter(c, b) > 0);
      if (cell) out.get(cell).push(b); else rest.push(b);
      continue;
    }
    for (const t of b.items) {
      const cx = t.x + t.w / 2, cy = b.base - b.size * 0.3;
      const cell = cells.find((c) => cx >= c.x && cx <= c.r && cy >= c.y && cy <= c.b);
      if (cell) out.get(cell).push({ t, b }); else rest.push(b);
    }
  }
  for (const [cell, list] of out) {
    const blocksIn = list.filter((k) => !k.t);
    const lines = new Map();
    for (const { t, b } of list.filter((k) => k.t)) {
      const key = [...lines.keys()].find((k) => Math.abs(k - b.base) < b.size * 0.35) ?? b.base;
      if (!lines.has(key)) lines.set(key, { base: b.base, size: b.size, items: [] });
      const l = lines.get(key); l.items.push(t); l.size = Math.max(l.size, b.size);
    }
    for (const l of lines.values()) blocksIn.push(fragment(l.items.sort((p, q) => p.x - q.x), l.base, l.size));
    cell.content = blocksIn.filter((k) => k.kind !== 'text' || k.runs.length);
  }
  return [...new Set(rest)];
}

function isRtl(items) {
  let r = 0, l = 0;
  for (const t of items) { if (RTL.test(t.str)) r++; else if (LTR.test(t.str)) l++; }
  return r > 0 && r >= l;
}

function readingOrder(items) {
  const kind = (s) => (RTL.test(s) ? 'R' : LTR.test(s) ? 'L' : 'N');
  const ks0 = items.map((t) => kind(t.str));
  if (!ks0.includes('R')) return items;
  const rtl = isRtl(items), flip = rtl ? 'L' : 'R', other = rtl ? 'R' : 'L';
  const out = rtl ? [...items].reverse() : [...items];
  const ks = rtl ? [...ks0].reverse() : ks0;
  for (let i = 0; i < out.length;) {
    if (ks[i] !== flip) { i++; continue; }
    let j = i, last = i;
    while (j < out.length && ks[j] !== other) { if (ks[j] === flip) last = j; j++; }
    out.splice(i, last - i + 1, ...out.slice(i, last + 1).reverse());
    i = last + 1;
  }
  return out;
}

function runsOf(items) {
  const runs = [];
  let prev = null;
  const rtl = isRtl(items);
  for (const t of readingOrder(items)) {
    const last = runs[runs.length - 1];
    if (prev && last) {
      const gap = Math.max(t.x - (prev.x + prev.w), prev.x - (t.x + t.w));
      if (((rtl ? prev.spaceBefore : t.spaceBefore) || gap > t.size * 0.15) && !/\s$/.test(last.text) && !/^\s/.test(t.str)) last.text += ' ';
    }
    prev = t;
    const run = { text: t.str, font: t.font || 'Arial', kind: t.kind || 'sans', size: t.size, bold: !!t.bold, italic: !!t.italic, color: t.color || '000000', link: t.link || null };
    const tail = runs[runs.length - 1];
    if (tail && tail.font === run.font && Math.abs(tail.size - run.size) < 0.3 && tail.bold === run.bold && tail.italic === run.italic
      && tail.color === run.color && tail.link === run.link) tail.text += run.text;
    else runs.push(run);
  }
  for (const r of runs) r.text = r.text.normalize('NFKC').replace(/\s+/g, ' ');
  if (runs.length) { runs[0].text = runs[0].text.trimStart(); runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd(); }
  return runs.filter((r) => r.text);
}

/** Lines of the same column that wrap into each other become one paragraph, so Word can reflow them. */
function paragraphs(frags, edge = Infinity) {
  const out = [];
  const sorted = [...frags].sort((a, b) => a.y - b.y || a.x - b.x);
  const used = new Set();
  for (const f of sorted) {
    if (used.has(f)) continue;
    used.add(f);
    const p = { ...f, lines: [f] };
    for (;;) {
      const last = p.lines[p.lines.length - 1];
      const next = sorted.find((g) => !used.has(g) && g.y > last.y && g.base - last.base > last.size * 0.6
        && g.base - last.base < Math.max(last.size, g.size) * 1.75 && Math.abs(g.size - last.size) < last.size * 0.12
        && Math.abs(g.x - p.x) < Math.max(2, last.size * 0.3) && sameStyle(g, last));
      if (!next) break;
      // Only a full line wraps into the next one: the next line's first word must not have
      // fitted at the end of this one. Otherwise these are separate lines (a name and a
      // class, a list) and stay separate paragraphs.
      const right = Math.max(p.r, next.r);
      if (last.r < right - last.size * 2.5) break;
      const text = next.runs.map((r) => r.text).join('');
      const word = (text.match(/^\S+/) || [''])[0].length * (next.w / Math.max(1, text.length));
      if (last.r + word + last.size * 0.25 < edge - 1) break;
      used.add(next);
      p.lines.push(next);
      Object.assign(p, union([p, next]));
    }
    p.pitch = p.lines.length > 1 ? (p.lines[p.lines.length - 1].base - p.lines[0].base) / (p.lines.length - 1) : p.size * 1.2;
    p.runs = [];
    for (const [i, l] of p.lines.entries()) {
      for (const [k, r] of l.runs.entries()) {
        const tail = p.runs[p.runs.length - 1];
        const lead = i && k === 0 ? (tail && /-$/.test(tail.text) && /^\p{Ll}/u.test(r.text) ? '' : ' ') : '';
        if (lead === '' && i && k === 0 && tail) tail.text = tail.text.replace(/-$/, '');
        p.runs.push({ ...r, text: lead + r.text });
      }
    }
    out.push(p);
  }
  return out;
}
const sameStyle = (a, b) => a.runs[0]?.font === b.runs[0]?.font && a.runs[0]?.bold === b.runs[0]?.bold;

/** Curved or slanted drawings (charts, logos made of paths, signatures) become one picture each. */
function findFigures(shapes, segs, fills, texts, page) {
  const seeds = shapes.filter((s) => area(s) > 4 && area(s) < page.w * page.h * 0.6);
  const groups = [];
  for (const s of seeds) {
    const g = groups.find((b) => inter({ ...b, x: b.x - 8, y: b.y - 8, r: b.r + 8, b: b.b + 8 }, s) > 0);
    if (g) Object.assign(g, union([g, s])); else groups.push({ ...s });
  }
  // merge groups that now overlap
  for (let i = 0; i < groups.length; i++) for (let j = groups.length - 1; j > i; j--) {
    if (inter({ ...groups[i], x: groups[i].x - 4, y: groups[i].y - 4, r: groups[i].r + 4, b: groups[i].b + 4 }, groups[j]) > 0) { Object.assign(groups[i], union([groups[i], groups[j]])); groups.splice(j, 1); }
  }
  const figures = [];
  for (const g of groups) {
    if (g.w < 6 || g.h < 6) continue;
    let fb = { ...g };
    // gridlines, axis labels and legends that sit on the drawing go with it
    for (let pass = 0; pass < 2; pass++) {
      const grow = { ...fb, x: fb.x - 14, y: fb.y - 14, r: fb.r + 14, b: fb.b + 14 };
      const parts = [
        ...segs.map(segBox).filter((b) => inside(b, grow) && Math.max(b.w, b.h) <= Math.max(fb.w, fb.h) * 1.05),
        ...texts.filter((t) => inside(t, grow, 0)),
      ];
      if (parts.length) fb = union([fb, ...parts]);
    }
    figures.push({ kind: 'figure', ...fb });
  }
  return figures;
}

/* ---------------------------------------------------------------- layout */

/** Blocks that overlap vertically sit side by side; everything else is stacked. */
function bands(blocks) {
  const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const b of sorted) {
    const band = out[out.length - 1];
    // overlap of more than a third of the shorter one counts as side by side
    if (band && b.y < band.b - Math.min(b.h, band.b - band.y) * 0.33 && b.y < band.b - 1) {
      band.items.push(b); band.b = Math.max(band.b, b.b);
    } else out.push({ y: b.y, b: b.b, items: [b] });
  }
  return out;
}

/** Within a band, blocks that overlap horizontally share a column. */
function columns(items) {
  const cols = [];
  for (const b of [...items].sort((a, c) => a.x - c.x)) {
    const col = cols.find((c) => b.x < c.r - 1 && b.r > c.x + 1);
    if (col) { col.items.push(b); col.x = Math.min(col.x, b.x); col.r = Math.max(col.r, b.r); } else cols.push({ x: b.x, r: b.r, items: [b] });
  }
  return cols.sort((a, b) => a.x - b.x);
}

export async function buildEditableDocx(pages, media, renderRegion, { title = '' } = {}) {
  const rels = [];
  const files = {};
  const fontsUsed = new Map();
  const links = new Map();
  let pic = 1;
  const linkId = (url) => { if (!links.has(url)) links.set(url, `rIdL${links.size + 1}`); return links.get(url); };
  const addMedia = (bytes, ext) => {
    const n = pic++;
    const name = `media/img${n}.${ext === 'jpeg' || ext === 'jpg' ? 'jpeg' : 'png'}`;
    files[`word/${name}`] = bytes;
    rels.push([`rIdM${n}`, 'image', name]);
    return { rid: `rIdM${n}`, n };
  };

  const runXml = (r, tighten = 0) => {
    fontsUsed.set(r.font, r.kind);
    const f = esc(r.font);
    const sz = Math.max(2, Math.round(r.size * 2));
    const rtl = RTL.test(r.text) ? '<w:rtl/>' : '';
    const rPr = `<w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>${r.bold ? '<w:b/><w:bCs/>' : ''}${r.italic ? '<w:i/><w:iCs/>' : ''}`
      + `${r.color && r.color !== '000000' ? `<w:color w:val="${r.color}"/>` : ''}${tighten ? `<w:spacing w:val="${Math.round(tighten * 20)}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${rtl}</w:rPr>`;
    const xml = `<w:r>${rPr}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
    return r.link ? `<w:hyperlink r:id="${linkId(r.link)}" w:history="1">${xml}</w:hyperlink>` : xml;
  };
  const spacer = (pt) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, tw(pt))}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`;
  const border = (side, e) => (e ? `<w:${side} w:val="single" w:sz="${Math.max(2, Math.min(96, Math.round(e.lw * 8)))}" w:space="0" w:color="${e.color || '000000'}"/>` : `<w:${side} w:val="nil"/>`);

  const inlinePicture = (rid, n, w, h) => `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(w)}" cy="${emu(h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="img${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  // Watermark-style pictures stay where they are on the page, behind the text.
  const pagePicture = (rid, n, im) => `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${n}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">`
    + `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(im.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(im.y)}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${emu(im.w)}" cy="${emu(im.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${n}" name="Picture ${n}"/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="img${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(im.w)}" cy="${emu(im.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;

  // Turns a list of blocks inside a frame [x0, x1] into body XML. `top` is where the frame's
  // content starts; `inCell` drops the trailing spacer rules that only make sense on a page.
  async function layout(blocks, x0, x1, top, pageIndex, opts = {}) {
    const xml = [];
    let cursor = top;
    const bs = bands(blocks);
    let lastWasTable = false;
    for (let bi = 0; bi < bs.length; bi++) {
      const band = bs[bi];
      const gap = Math.max(0, band.y - cursor);
      const cols = columns(band.items);
      if (cols.length === 1) {
        // One column: the blocks go one under the other, even if they overlap a little.
        let at = cursor;
        for (const b of [...cols[0].items].sort((p, q) => p.y - q.y)) {
          const out = await blockXml(b, x0, x1, Math.max(0, b.y - at), pageIndex, lastWasTable);
          xml.push(out.xml);
          lastWasTable = out.table;
          at = Math.max(at, b.b);
        }
      } else {
        // Side by side: a table without borders, one column each. Rows that keep the same
        // columns (labels and values, for instance) are gathered into the same table.
        const rows = [cols];
        while (bi + 1 < bs.length) {
          const next = columns(bs[bi + 1].items);
          const same = next.length === cols.length && next.every((c, k) => Math.abs(c.x - cols[k].x) < 4 && c.items.length === 1 && c.items[0].kind === 'text')
            && cols.every((c) => c.items.length === 1 && c.items[0].kind === 'text') && bs[bi + 1].y - bs[bi].b < 14;
          if (!same) break;
          rows.push(next); bi++;
        }
        if (gap > 0.5 || lastWasTable) xml.push(spacer(gap || 1));
        const edges = cols.map((c) => c.x);
        const ws = edges.map((e, k) => (k + 1 < edges.length ? edges[k + 1] - e : Math.max(x1, ...rows.map((r) => r[k]?.r || 0)) - e));
        const indent = edges[0] - x0;
        const trs = [];
        for (const [ri, row] of rows.entries()) {
          const rowTop = ri ? Math.min(...row.flatMap((c) => c.items.map((i) => i.y))) : band.y;
          const tcs = [];
          for (const [k, c] of row.entries()) {
            const inner = await layout(c.items, c.x, c.x + ws[k], rowTop, pageIndex, { inCell: true });
            tcs.push(`<w:tc><w:tcPr><w:tcW w:w="${tw(ws[k])}" w:type="dxa"/></w:tcPr>${inner || '<w:p/>'}</w:tc>`);
          }
          trs.push(`<w:tr>${tcs.join('')}</w:tr>`);
        }
        xml.push(`<w:tbl><w:tblPr><w:tblW w:w="${tw(ws.reduce((a, b) => a + b, 0))}" w:type="dxa"/><w:tblInd w:w="${tw(indent)}" w:type="dxa"/>`
          + '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
          + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>'
          + `<w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${tw(w)}"/>`).join('')}</w:tblGrid>${trs.join('')}</w:tbl>`);
        lastWasTable = true;
        cursor = Math.max(...rows[rows.length - 1].flatMap((c) => c.items.map((i) => i.b)));
        continue;
      }
      cursor = band.b;
    }
    if (opts.inCell && lastWasTable) xml.push(spacer(1));
    return xml.join('');
  }

  async function blockXml(b, x0, x1, gap, pageIndex, afterTable) {
    const ind = Math.max(0, b.x - x0);
    if (b.kind === 'text') {
      const width = x1 - x0;
      const centre = Math.abs((b.x + b.r) / 2 - (x0 + x1) / 2) < Math.max(4, width * 0.03) && b.x - x0 > width * 0.08;
      const rightAligned = !centre && Math.abs(x1 - b.r) < 3 && b.x - x0 > width * 0.3;
      const jc = b.rtl ? 'right' : centre ? 'center' : rightAligned ? 'right' : 'left';
      const indXml = jc === 'left' ? `<w:ind w:left="${tw(ind)}"/>` : jc === 'right' && !b.rtl ? '<w:ind w:left="0"/>' : '';
      const line = Math.max(b.pitch || 0, b.size * 1.2);
      const before = Math.max(0, gap - (line - b.size * 1.17) / 2);
      // A single line that the stand-in font would make wider than it was gets its letters
      // drawn a little closer, so it doesn't wrap or push into its neighbour.
      let tighten = 0;
      const lines = b.lines?.length || 1;
      if (lines === 1) {
        const chars = b.runs.reduce((n, r) => n + [...r.text].length, 0);
        const natural = guessWidth(b.runs);
        const room = Math.max(b.w, Math.min(x1 - b.x, b.w * 1.05));
        if (chars > 1 && natural > room) tighten = Math.max(-b.size * 0.15, (room - natural) / chars);
      }
      // exact line height keeps rows and boxes the height they were, whatever font Word picks
      return {
        xml: `<w:p><w:pPr>${b.rtl ? '<w:bidi/>' : ''}<w:spacing w:before="${tw(before)}" w:after="0" w:line="${tw(line)}" w:lineRule="exact"/>${indXml}<w:jc w:val="${jc}"/></w:pPr>${b.runs.map((r) => runXml(r, tighten)).join('')}</w:p>`,
        table: false,
      };
    }
    if (b.kind === 'image' || b.kind === 'figure') {
      const m = b.kind === 'image' ? media[b.id] : { bytes: await renderRegion(pageIndex, b), ext: 'png' };
      if (!m?.bytes) return { xml: '', table: false };
      const { rid, n } = addMedia(m.bytes, m.ext);
      return { xml: `<w:p><w:pPr><w:spacing w:before="${tw(gap)}" w:after="0"/><w:ind w:left="${tw(ind)}"/></w:pPr>${inlinePicture(rid, n, b.w, b.h)}</w:p>`, table: false };
    }
    if (b.kind === 'rule') {
      const e = { color: b.color, lw: b.lw };
      return {
        xml: `<w:p><w:pPr><w:pBdr>${border('bottom', e)}</w:pBdr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, tw(gap))}" w:lineRule="exact"/><w:ind w:left="${tw(ind)}" w:right="${tw(Math.max(0, x1 - b.r))}"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`,
        table: false,
      };
    }
    // tables and boxes
    const pre = gap > 0.5 || afterTable ? spacer(gap || 1) : '';
    return { xml: pre + await tableXml(b, x0, pageIndex), table: true };
  }

  async function tableXml(t, x0, pageIndex) {
    const xs = t.kind === 'box' ? [t.x, t.r] : t.xs;
    const ys = t.kind === 'box' ? [t.y, t.b] : t.ys;
    const cells = t.cells || [{ row: 0, col: 0, row2: 0, col2: 0, ...box(t), border: t.border, fill: t.fill, content: t.content }];
    const ws = xs.slice(1).map((v, i) => v - xs[i]);
    const pad = t.kind === 'box' ? 0 : 2;
    const trs = [];
    for (let r = 0; r < ys.length - 1; r++) {
      const tcs = [];
      for (let c = 0; c < xs.length - 1;) {
        const cell = cells.find((k) => k.col === c && r >= k.row && r <= k.row2);
        if (!cell) { c++; continue; }
        const span = cell.col2 - cell.col + 1;
        const w = xs[cell.col2 + 1] - xs[cell.col];
        const vm = cell.row2 > cell.row ? (r === cell.row ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '';
        const b = cell.border || {};
        const borders = `<w:tcBorders>${border('top', b.top)}${border('left', b.left)}${border('bottom', b.bottom)}${border('right', b.right)}</w:tcBorders>`;
        const shd = cell.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.fill}"/>` : '';
        let inner = '<w:p/>';
        let valign = 'top';
        if (r === cell.row && cell.content?.length) {
          const top = Math.min(...cell.content.map((k) => k.y)), bottom = Math.max(...cell.content.map((k) => k.b));
          // text sitting in the middle of a tall cell is centred rather than padded down
          const centred = t.kind !== 'box' && Math.abs((top - cell.y) - (cell.b - bottom)) < Math.max(3, cell.h * 0.15);
          valign = centred ? 'center' : 'top';
          inner = await layout(cell.content, cell.x + pad, cell.r - pad, centred ? top : cell.y, pageIndex, { inCell: true }) || '<w:p/>';
        }
        // A cell that held one line in the PDF keeps it on one line, even if Word's stand-in
        // font is a little wider, so rows don't grow.
        const oneLine = cell.content?.length === 1 && cell.content[0].kind === 'text' && (cell.content[0].lines?.length || 1) === 1;
        tcs.push(`<w:tc><w:tcPr><w:tcW w:w="${tw(w)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${vm}${borders}${shd}${oneLine ? '<w:noWrap/>' : ''}<w:vAlign w:val="${valign}"/></w:tcPr>${inner}</w:tc>`);
        c += span;
      }
      const h = ys[r + 1] - ys[r];
      trs.push(`<w:tr><w:trPr><w:trHeight w:val="${tw(h)}" w:hRule="atLeast"/></w:trPr>${tcs.join('')}</w:tr>`);
    }
    return `<w:tbl><w:tblPr><w:tblW w:w="${tw(xs[xs.length - 1] - xs[0])}" w:type="dxa"/><w:tblInd w:w="${tw(Math.max(0, xs[0] - x0))}" w:type="dxa"/>`
      + `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${tw(pad)}" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="${tw(pad)}" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>`
      + `<w:tblGrid>${ws.map((w) => `<w:gridCol w:w="${tw(w)}"/>`).join('')}</w:tblGrid>${trs.join('')}</w:tbl>`;
  }

  const body = [];
  for (const [pi, raw] of pages.entries()) {
    const page = bulletsAsText(raw);
    const { segs, fills, shapes } = segmentsOf(page);
    const frags = textFragments(page.texts);
    const tables = findTables(segs, fills);
    const tableSegs = new Set(tables.flatMap((t) => t.segs));
    let figures = findFigures(shapes, segs.filter((s) => !tableSegs.has(s)), fills, frags, page);
    // a figure that is really a table's decoration is dropped
    figures = figures.filter((f) => !tables.some((t) => inside(f, t, 2)));

    // Pictures: big faint ones under other content are watermarks and stay on the page.
    const images = page.images.filter((im) => im.w > 2 && im.h > 2 && media[im.id]);
    const overlaps = (im) => frags.filter((f) => inter(box(im), f) > area(f) * 0.5).length + tables.filter((t) => inter(box(im), t) > area(box(im)) * 0.2).length;
    const watermarks = images.filter((im) => im.faint || overlaps(im) >= 3);
    const flowImages = images.filter((im) => !watermarks.includes(im) && !figures.some((f) => inside(box(im), f, 2)));

    // Boxes: filled or outlined areas that are not tables, from biggest to smallest.
    const used = new Set();
    const pageArea = page.w * page.h;
    let boxes = fills.filter((f) => f.w > 8 && f.h > 8 && area(f) < pageArea * 0.85 && !(light(f.fill) && !f.stroke)
      && !tables.some((t) => inside(f, t, 3)) && !figures.some((g) => inside(f, g, 2)))
      .map((f) => ({ kind: 'box', ...box(f), fill: light(f.fill) ? null : f.fill, border: f.stroke ? Object.fromEntries(['top', 'left', 'bottom', 'right'].map((s) => [s, { color: f.stroke, lw: f.lw || 0.75 }])) : {} }));
    // a box exactly on top of another (fill and outline drawn separately) is one box
    boxes = boxes.filter((b, i) => !boxes.some((o, j) => j < i && Math.abs(o.x - b.x) < 1.5 && Math.abs(o.y - b.y) < 1.5 && Math.abs(o.w - b.w) < 1.5 && Math.abs(o.h - b.h) < 1.5 && (Object.assign(o, { fill: o.fill || b.fill, border: Object.keys(o.border).length ? o.border : b.border }), true)));
    // lines along a box edge are that box's border (a coloured bar down one side, say)
    const loose = segs.filter((s) => !tableSegs.has(s));
    for (const b of boxes) {
      for (const s of loose) {
        if (used.has(s)) continue;
        const near = (p, q) => Math.abs(p - q) <= Math.max(2, s.lw);
        const side = s.dir === 'v' ? (near(s.p, b.x) ? 'left' : near(s.p, b.r) ? 'right' : null)
          : (near(s.p, b.y) ? 'top' : near(s.p, b.b) ? 'bottom' : null);
        const len = s.dir === 'v' ? b.h : b.w;
        const along = s.dir === 'v' ? Math.min(s.z, b.b) - Math.max(s.a, b.y) : Math.min(s.z, b.r) - Math.max(s.a, b.x);
        if (side && along >= len * 0.5) { b.border[side] = { color: s.color, lw: s.lw }; used.add(s); }
      }
    }
    const rules = loose.filter((s) => !used.has(s) && s.dir === 'h' && s.z - s.a > 12 && !figures.some((f) => inside(segBox(s), f, 2)))
      .map((s) => ({ kind: 'rule', ...segBox(s), color: s.color, lw: s.lw }));

    // Leaves (things that hold no other blocks) and containers (tables, boxes).
    const leaves = [
      ...frags.filter((f) => !figures.some((g) => inside(f, g, 2))),
      ...flowImages.map((im) => ({ kind: 'image', ...box(im), id: im.id })),
      ...figures,
      ...rules,
    ];
    const containers = [...tables, ...boxes].sort((a, b) => area(a) - area(b));
    // smallest container that holds each block
    const holder = (blk) => containers.find((c) => c !== blk && area(c) > area(blk) && inside(blk, c, 2));
    for (const c of containers) { c.children = []; }
    const top = [];
    for (const blk of [...leaves, ...containers]) {
      const h = holder(blk);
      if (h) h.children.push(blk); else top.push(blk);
    }
    for (const t of containers) {
      if (t.kind === 'table') {
        cellText(t.children, t.cells);
        for (const cell of t.cells) cell.content = joinParagraphs(cell.content, cell.r - 2);
      } else {
        // text inside a box keeps the same padding on the right as on the left
        const pad = t.children.length ? Math.max(0, Math.min(...t.children.map((k) => k.x)) - t.x) : 0;
        t.content = joinParagraphs(t.children, t.r - pad);
      }
    }
    for (const b of boxes) { b.cells = [{ row: 0, col: 0, row2: 0, col2: 0, ...box(b), border: b.border, fill: b.fill, content: b.content }]; }

    const flow = joinParagraphs(top, Math.max(...top.map((b) => b.r)));
    const left = Math.max(14, Math.min(page.w * 0.2, ...flow.map((b) => b.x)) - 0.5);
    const right = Math.max(14, page.w - Math.max(...flow.map((b) => b.r), page.w * 0.8) - 2);
    const topM = Math.max(10, Math.min(page.h * 0.2, ...flow.map((b) => b.y)) - 1);
    const xml = await layout(flow, left, page.w - right, topM, pi);
    const marks = [];
    for (const im of watermarks) {
      const { rid, n } = addMedia(media[im.id].bytes, media[im.id].ext);
      marks.push(pagePicture(rid, n, im));
    }
    // watermarks ride on the first paragraph of the page
    const firstP = xml.indexOf('</w:pPr>');
    const pageXml = marks.length && firstP > 0 ? xml.slice(0, firstP + 8) + marks.join('') + xml.slice(firstP + 8)
      : (marks.length ? `<w:p>${marks.join('')}</w:p>` : '') + xml;
    const sect = `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${tw(page.w)}" w:h="${tw(page.h)}"${page.w > page.h ? ' w:orient="landscape"' : ''}/>`
      + `<w:pgMar w:top="${tw(topM)}" w:right="${tw(right)}" w:bottom="${tw(10)}" w:left="${tw(left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
    body.push(pageXml || '<w:p/>');
    if (pi < pages.length - 1) body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${sect}</w:pPr></w:p>`);
    else body.push(sect);
  }

  return packDocx(body.join(''), { title, rels, files, fontsUsed, links });
}

function joinParagraphs(blocks, edge) {
  const texts = blocks.filter((b) => b.kind === 'text' && !b.lines);
  return [...blocks.filter((b) => b.kind !== 'text' || b.lines), ...paragraphs(texts, edge)];
}

const FALLBACK = { sans: ['Arial', 'swiss', 'variable'], serif: ['Times New Roman', 'roman', 'variable'], mono: ['Courier New', 'modern', 'fixed'] };

function packDocx(bodyXml, { title, rels, files, fontsUsed, links }) {
  const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const NS = `${W} xmlns:r="${REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const all = [['rId1', 'styles', 'styles.xml'], ['rId2', 'settings', 'settings.xml'], ['rId3', 'fontTable', 'fontTable.xml'], ...rels];
  files['[Content_Types].xml'] = `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>`
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  files['_rels/.rels'] = `${XMLH}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="${PKG}/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  files['docProps/core.xml'] = `${XMLH}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  files['word/_rels/document.xml.rels'] = `${XMLH}<Relationships xmlns="${PKG}">${all.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}`
    + `${[...links].map(([url, id]) => `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${esc(url)}" TargetMode="External"/>`).join('')}</Relationships>`;
  files['word/styles.xml'] = `${XMLH}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl w:val="0"/></w:pPr></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style></w:styles>';
  files['word/settings.xml'] = `${XMLH}<w:settings ${W}><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  files['word/fontTable.xml'] = `${XMLH}<w:fonts ${W}>${[...fontsUsed].map(([name, kind]) => {
    const [alt, family, pitch] = FALLBACK[kind] || FALLBACK.sans;
    return `<w:font w:name="${esc(name)}">${alt !== name ? `<w:altName w:val="${alt}"/>` : ''}<w:family w:val="${family}"/><w:pitch w:val="${pitch}"/></w:font>`;
  }).join('')}</w:fonts>`;
  files['word/document.xml'] = `${XMLH}<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`;
  return files;
}

/* ---------------------------------------------------------------- PowerPoint */

/**
 * The same page contents as an editable PowerPoint deck, one slide per page. Slides are
 * laid out by position anyway, so everything stays where it was on the page: boxes and
 * lines are PowerPoint shapes, photos are pictures, each paragraph is a text box, and only
 * charts and other drawings with no PowerPoint equivalent become pictures of that area.
 */
export async function buildEditablePptx(pages, media, renderRegion, { title = '' } = {}) {
  const files = {};
  const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const P = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
  const rels = (list) => `${XMLH}<Relationships xmlns="${PKG}">${list.map(([id, type, target, ext]) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${REL}/${type}`}" Target="${esc(target)}"${ext ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
  const first = pages[0] || { w: 612, h: 792 };
  const CX = emu(first.w), CY = emu(first.h);
  const fill = (hex) => (hex ? `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>` : '<a:noFill/>');
  const ln = (hex, lw) => (hex ? `<a:ln w="${Math.max(3175, Math.round(lw * 12700))}">${fill(hex)}</a:ln>` : '<a:ln><a:noFill/></a:ln>');
  let mediaN = 0;
  const mediaParts = new Map();

  for (const [pi, raw] of pages.entries()) {
    const page = bulletsAsText(raw);
    const k = Math.min(first.w / page.w, first.h / page.h);
    const ox = (first.w - page.w * k) / 2, oy = (first.h - page.h * k) / 2;
    const X = (v) => emu(ox + v * k), Y = (v) => emu(oy + v * k), L = (v) => emu(v * k);
    const xfrm = (b, extra = '') => `<a:xfrm${extra}><a:off x="${X(b.x)}" y="${Y(b.y)}"/><a:ext cx="${L(Math.max(0.1, b.w))}" cy="${L(Math.max(0.1, b.h))}"/></a:xfrm>`;
    const slideRels = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    const shapes = [];
    let id = 2;
    const picture = (b, bytes, ext, name) => {
      if (!bytes?.length) return;
      let part = mediaParts.get(bytes);
      if (!part) { part = `media/image${++mediaN}.${ext}`; mediaParts.set(bytes, part); files[`ppt/${part}`] = bytes; }
      const rid = `rId${slideRels.length + 1}`;
      slideRels.push([rid, 'image', `../${part}`]);
      shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id++}" name="${esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
        + `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
    };

    const { segs, fills, shapes: drawn } = segmentsOf(page);
    const frags = textFragments(page.texts);
    const figures = findFigures(drawn, segs, fills, frags, page);
    const inFigure = (b) => figures.some((f) => inside(b, f, 2));
    const images = page.images.filter((im) => im.w > 2 && im.h > 2 && media[im.id]);

    // see-through pictures (watermarks) go underneath everything
    for (const im of images.filter((i) => i.faint)) picture(im, media[im.id].bytes, media[im.id].ext, 'Watermark');
    const pageArea = page.w * page.h;
    for (const f of fills) {
      if (inFigure(f) || f.w < 0.5 || f.h < 0.5) continue;
      if (!f.stroke && (!f.fill || f.fill === 'FFFFFF') ) continue; // white on a white slide
      if (!f.stroke && area(f) > pageArea * 0.9 && light(f.fill)) continue;
      const geom = f.round ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, 8 / Math.max(1, Math.min(f.w, f.h)) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
      shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Box ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(f)}${geom}${fill(f.fill)}${ln(f.stroke, f.lw || 0.75)}</p:spPr></p:sp>`);
    }
    for (const s of segs) {
      const b = segBox(s);
      if (inFigure(b)) continue;
      const line = s.dir === 'h' ? { x: s.a, y: s.p, w: s.z - s.a, h: 0 } : { x: s.p, y: s.a, w: 0, h: s.z - s.a };
      shapes.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id++}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(line)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${ln(s.color || '000000', s.lw)}</p:spPr></p:cxnSp>`);
    }
    for (const im of images.filter((i) => !i.faint && !inFigure(i))) picture(im, media[im.id].bytes, media[im.id].ext, 'Picture');
    for (const f of figures) picture(f, await renderRegion(pi, f), 'png', 'Drawing');

    // one text box per paragraph
    for (const p of paragraphs(frags.filter((f) => !inFigure(f)))) {
      const lines = p.lines;
      const lefts = lines.map((l) => l.x), rights = lines.map((l) => l.r), mids = lines.map((l) => (l.x + l.r) / 2);
      const spread = (v) => Math.max(...v) - Math.min(...v);
      const rtl = p.rtl;
      const algn = rtl ? 'r' : lines.length > 1 && spread(lefts) > 2 && spread(mids) < 2 ? 'ctr' : lines.length > 1 && spread(lefts) > 2 && spread(rights) < 2 ? 'r' : 'l';
      const multi = lines.length > 1;
      const top = lines[0].base - lines[0].size * 0.93;
      const w = multi ? p.w * 1.04 + 1 : p.w + p.size * 2;
      const x = algn === 'r' ? p.r - w : algn === 'ctr' ? (p.x + p.r) / 2 - w / 2 : p.x;
      const b = { x, y: top, w, h: p.b - top };
      const runs = p.runs.map((r) => {
        const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(r.text);
        const face = esc(r.font || 'Arial');
        return `<a:r><a:rPr lang="${rtl ? 'ar-SA' : 'en-GB'}" sz="${Math.max(100, Math.round(r.size * k * 100))}"${r.bold ? ' b="1"' : ''}${r.italic ? ' i="1"' : ''} dirty="0">`
          + `${fill(r.color || '000000')}<a:latin typeface="${face}"/>${cjk ? `<a:ea typeface="${face}"/>` : ''}${rtl ? `<a:cs typeface="${face}"/>` : ''}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
      }).join('');
      const pitch = multi ? `<a:lnSpc><a:spcPts val="${Math.round(p.pitch * k * 100)}"/></a:lnSpc>` : '';
      shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id++}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
        + `<p:txBody><a:bodyPr wrap="${multi ? 'square' : 'none'}" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>`
        + `<a:p><a:pPr algn="${algn}"${rtl ? ' rtl="1"' : ''}>${pitch}<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${runs}</a:p></p:txBody></p:sp>`);
    }

    const tree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
    files[`ppt/slides/slide${pi + 1}.xml`] = `${XMLH}<p:sld ${P}><p:cSld><p:spTree>${tree}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/_rels/slide${pi + 1}.xml.rels`] = rels(slideRels);
  }

  const n = pages.length;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['[Content_Types].xml'] = `${XMLH}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>`
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + '</Types>';
  files['_rels/.rels'] = rels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml']]);
  files['docProps/core.xml'] = `${XMLH}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  files['ppt/_rels/presentation.xml.rels'] = rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'],
    ...Array.from({ length: n }, (_, i) => [`rId${i + 10}`, 'slide', `slides/slide${i + 1}.xml`])]);
  files['ppt/presentation.xml'] = `${XMLH}<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${CX}" cy="${CY}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const empty = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
  files['ppt/slideMasters/slideMaster1.xml'] = `${XMLH}<p:sldMaster ${P}><p:cSld><p:spTree>${empty}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]);
  files['ppt/slideLayouts/slideLayout1.xml'] = `${XMLH}<p:sldLayout ${P} type="blank"><p:cSld name="Blank"><p:spTree>${empty}</p:spTree></p:cSld></p:sldLayout>`;
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]);
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  files['ppt/theme/theme1.xml'] = `${XMLH}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sheaf"><a:themeElements>`
    + '<a:clrScheme name="Sheaf"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>'
    + ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'].map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join('')
    + '<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>'
    + '<a:fontScheme name="Sheaf"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
    + `<a:fmtScheme name="Sheaf"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350">${solid}</a:ln><a:ln w="12700">${solid}</a:ln><a:ln w="19050">${solid}</a:ln></a:lnStyleLst>`
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  return files;
}
