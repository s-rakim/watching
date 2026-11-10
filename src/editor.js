// Page-by-page editor used by Edit, Sign, Redact and Crop. Items live in page-relative
// coordinates (0..1, origin top-left of the page as shown) so they survive resizes.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LABELS = {
  text: ['text', 'Text'], image: ['image', 'Image'], rect: ['square', 'Shape'], whiteout: ['eraser', 'White out'],
  signature: ['pen', 'Signature'], date: ['calendar', 'Date'], redact: ['redact', 'Redact area'], crop: ['crop', 'Crop frame'],
  edittext: ['editText', 'Edit text'], ink: ['pencil', 'Draw'], highlight: ['highlighter', 'Highlight'],
};
const HIGHLIGHT = '#ffe14d';

/**
 * Lines of text already on a page, in the same 0..1 page coordinates the editor uses.
 * pdf.js reports each run with a transform; applying the viewport transform gives its
 * on-screen baseline and size, then neighbouring runs on one baseline are joined.
 */
async function pageTextLines(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const runs = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const m = mul(vp.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!size) continue;
    // Only handle text that reads left to right on screen. Rotated runs are skipped.
    if (Math.abs(m[1]) > 0.01 * size || m[0] <= 0) continue;
    // The page has been rendered by now, so the real font (name, bold flag) is loaded.
    let real = null;
    try { if (page.commonObjs.has(it.fontName)) real = page.commonObjs.get(it.fontName); } catch { /* not loaded */ }
    const fam = `${tc.styles[it.fontName]?.fontFamily || ''} ${real?.name || ''} ${real?.bold || real?.black ? 'bold' : ''}`;
    runs.push({ x: m[4], base: m[5], size, w: it.width * (m[0] / Math.hypot(it.transform[0], it.transform[1]) || 1), str: it.str,
      serif: isSerif(fam), bold: /bold|black|heavy|semibold/i.test(fam) });
  }
  runs.sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const r of runs) {
    const l = lines.find((q) => Math.abs(q.base - r.base) < q.size * 0.35 && r.x - q.end < q.size * 1.5 && r.x > q.x - 1);
    if (l) {
      if (r.x - l.end > l.size * 0.15 && !l.text.endsWith(' ') && !r.str.startsWith(' ')) l.text += ' ';
      l.text += r.str; l.end = Math.max(l.end, r.x + r.w); l.size = Math.max(l.size, r.size);
      l.serif ||= r.serif; l.bold ||= r.bold;
    } else lines.push({ x: r.x, end: r.x + r.w, base: r.base, size: r.size, text: r.str, serif: r.serif, bold: r.bold });
  }
  return lines.map((l) => ({
    x: l.x / vp.width, w: (l.end - l.x) / vp.width,
    y: (l.base - l.size * 0.92) / vp.height, h: (l.size * 1.2) / vp.height,
    base: l.base / vp.height, size: l.size / vp.height,
    text: l.text.replace(/\s+/g, ' ').trim(), font: (l.serif ? 'serif' : 'sans') + (l.bold ? '-bold' : ''),
  }));
}
function isSerif(fam) {
  const f = fam.replace(/sans-serif/gi, 'sans');
  return /times|georgia|garamond|roman|minion|cambria|palatino|serif/i.test(f) && !/sans|helvetica|arial|verdana/i.test(f);
}
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
// Single quotes only: these go inside a style="" attribute.
const FONT_CSS = { sans: "Helvetica, Arial, sans-serif", serif: "'Times New Roman', Times, serif", mono: "'Courier New', monospace" };

export function mountCanvasEditor(stage, session, { icon, renderPage }) {
  const file = session.files[0];
  const palette = session.tool.palette;
  const st = {
    page: 0, items: [], active: palette[0] === 'crop' ? null : palette[0], sel: null,
    color: '#111827', fontSize: 16, font: 'sans', signature: null, seq: 0, inkWidth: 3,
    lines: new Map(), // page index -> existing text lines, read lazily
  };
  if (palette[0] === 'crop') st.items.push({ id: ++st.seq, type: 'crop', page: -1, x: 0.08, y: 0.08, w: 0.84, h: 0.84 });

  stage.innerHTML = `
    <div class="ed">
      <div class="ed-bar">
        <button class="btn btn-ghost" data-nav="-1" aria-label="Previous page">${icon('chevronLeft', 18)}</button>
        <span class="ed-count" aria-live="polite"></span>
        <button class="btn btn-ghost" data-nav="1" aria-label="Next page">${icon('chevronRight', 18)}</button>
      </div>
      <div class="ed-scroll"><div class="ed-page"><div class="ed-layer"></div></div></div>
    </div>`;
  const pageEl = stage.querySelector('.ed-page');
  const layer = stage.querySelector('.ed-layer');
  const count = stage.querySelector('.ed-count');

  async function show() {
    count.textContent = `Page ${st.page + 1} of ${file.pageCount}`;
    const width = Math.min(stage.querySelector('.ed-scroll').clientWidth - 32, 860);
    const canvas = await renderPage(file.pdf, st.page + 1, { maxWidth: Math.max(280, width) * (window.devicePixelRatio || 1) });
    canvas.style.width = `${canvas.width / (window.devicePixelRatio || 1)}px`;
    pageEl.querySelector('canvas')?.remove();
    pageEl.prepend(canvas);
    pageEl.style.width = canvas.style.width;
    if (palette.includes('edittext') && !st.lines.has(st.page)) {
      st.lines.set(st.page, await pageTextLines(file.pdf, st.page + 1).catch(() => []));
    }
    draw();
  }

  const visible = () => st.items.filter((i) => i.page === st.page || i.page === -1);

  function hits() {
    if (st.active !== 'edittext') return '';
    const lines = st.lines.get(st.page) || [];
    const used = new Set(st.items.filter((i) => i.page === st.page && i.line != null).map((i) => i.line));
    return lines.map((l, i) => used.has(i) ? '' : `<button type="button" class="txt-hit" data-line="${i}" title="Edit this text" style="left:${l.x * 100}%;top:${l.y * 100}%;width:${l.w * 100}%;height:${l.h * 100}%"><span class="sr">Edit: ${esc(l.text)}</span></button>`).join('');
  }

  function draw() {
    const H = pageEl.clientHeight;
    layer.innerHTML = hits() + visible().map((it) => {
      const box = `left:${it.x * 100}%;top:${it.y * 100}%;width:${it.w ? it.w * 100 + '%' : 'auto'};height:${it.h && it.type !== 'text' ? it.h * 100 + '%' : 'auto'}`;
      const sel = st.sel === it.id ? ' sel' : '';
      const del = it.type === 'crop' ? '' : `<button class="it-del" aria-label="Delete">${icon('x', 12)}</button>`;
      const grip = it.type === 'text' ? '' : '<i class="it-grip"></i>';
      if (it.type === 'text') {
        const [fam, weight] = (it.font || 'sans').split('-');
        return `<div class="it it-text${sel}" data-id="${it.id}" style="${box};font-size:${it.fontSize * H}px;color:${it.color};font-family:${FONT_CSS[fam] || FONT_CSS.sans};font-weight:${weight ? 700 : 400}"><div class="it-edit" contenteditable="plaintext-only" spellcheck="false">${esc(it.text)}</div>${del}</div>`;
      }
      if (it.type === 'ink') {
        const W = pageEl.clientWidth;
        const pts = it.points.map(([px, py]) => `${(px * it.w * W).toFixed(1)},${(py * it.h * H).toFixed(1)}`).join(' ');
        return `<div class="it it-ink${sel}" data-id="${it.id}" style="${box}"><svg width="100%" height="100%" overflow="visible" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${it.color}" stroke-width="${it.width * H}" stroke-linecap="round" stroke-linejoin="round"/></svg>${del}</div>`;
      }
      if (it.type === 'highlight') return `<div class="it it-highlight${sel}" data-id="${it.id}" style="${box}">${del}${grip}</div>`;
      if (it.type === 'image') return `<div class="it it-image${sel}" data-id="${it.id}" style="${box}"><img src="${it.url}" alt="" draggable="false"/>${del}${grip}</div>`;
      const style = it.type === 'rect' ? `border:2px solid ${it.color};${it.fill ? `background:${it.color}` : ''}` : '';
      return `<div class="it it-${it.type}${sel}" data-id="${it.id}" style="${box};${style}">${del}${grip}</div>`;
    }).join('');
    layer.dataset.tool = st.active || '';
  }

  /* ---- pointer handling: draw new boxes, drag and resize existing ones ---- */
  const rel = (e) => {
    const r = layer.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const byEl = (el) => st.items.find((i) => i.id === Number(el?.dataset.id));

  layer.addEventListener('pointerdown', (e) => {
    const itEl = e.target.closest('.it');
    if (e.target.closest('.it-del')) { remove(byEl(itEl)); return draw(); }
    const hit = e.target.closest('.txt-hit');
    if (hit) { e.preventDefault(); return editLine(Number(hit.dataset.line)); }
    const start = rel(e);
    if (itEl) {
      const it = byEl(itEl);
      st.sel = it.id;
      layer.querySelectorAll('.it').forEach((n) => n.classList.toggle('sel', n === itEl));
      if (e.target.closest('.it-edit') && document.activeElement === e.target.closest('.it-edit')) return;
      const resizing = !!e.target.closest('.it-grip');
      const o = { ...it };
      if (it.patch) { const pt = st.items.find((i) => i.id === it.patch); if (pt) { o.px = pt.x; o.py = pt.y; } }
      let moved = false;
      const move = (ev) => {
        const p = rel(ev); moved = true;
        if (resizing) { it.w = Math.max(0.02, Math.min(1 - o.x, o.w + p.x - start.x)); it.h = Math.max(0.015, Math.min(1 - o.y, o.h + p.y - start.y)); }
        else {
          it.x = Math.max(0, Math.min(1 - (o.w || 0), o.x + p.x - start.x)); it.y = Math.max(0, Math.min(1 - (o.h || 0), o.y + p.y - start.y));
          // a replaced line drags its white-out patch along with it
          const patch = it.patch && st.items.find((i) => i.id === it.patch);
          if (patch) { patch.x = o.px + it.x - o.x; patch.y = o.py + it.y - o.y; }
        }
        itEl.style.left = `${it.x * 100}%`; itEl.style.top = `${it.y * 100}%`;
        if (resizing) { itEl.style.width = `${it.w * 100}%`; itEl.style.height = `${it.h * 100}%`; }
        if (it.patch) draw();
      };
      const up = () => { window.removeEventListener('pointermove', move); if (!moved && it.type === 'text') itEl.querySelector('.it-edit').focus(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      if (!e.target.closest('.it-edit')) e.preventDefault();
      return;
    }
    st.sel = null;
    const tool = st.active;
    if (!tool) return draw();
    if (tool === 'text' || tool === 'date') {
      const it = { id: ++st.seq, type: 'text', page: st.page, x: start.x, y: start.y, w: 0, h: 0, text: tool === 'date' ? new Date().toLocaleDateString() : 'Text', color: st.color, fontSize: st.fontSize / 792, font: st.font };
      st.items.push(it); st.sel = it.id; draw();
      if (tool === 'text') {
        const ed = layer.querySelector(`[data-id="${it.id}"] .it-edit`);
        ed.focus();
        document.getSelection().selectAllChildren(ed);
      }
      e.preventDefault();
      return;
    }
    if (tool === 'signature' || tool === 'image') {
      const src = tool === 'signature' ? st.signature : st.image;
      if (!src) return tool === 'signature' ? openSignature() : imgInput.click();
      const w = tool === 'signature' ? 0.28 : 0.35;
      const hgt = (w * pageEl.clientWidth * src.h / src.w) / pageEl.clientHeight;
      const it = { id: ++st.seq, type: 'image', page: st.page, x: Math.min(start.x, 1 - w), y: Math.min(start.y, 1 - hgt), w, h: hgt, url: src.url, bytes: src.bytes, mime: src.mime };
      st.items.push(it); st.sel = it.id;
      return draw();
    }
    if (tool === 'edittext') return draw();
    if (tool === 'ink') {
      const raw = [[start.x, start.y]];
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'ink-live');
      const line = document.createElementNS(ns, 'polyline');
      Object.entries({ fill: 'none', stroke: st.color, 'stroke-width': st.inkWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }).forEach(([k, v]) => line.setAttribute(k, v));
      svg.append(line); layer.append(svg);
      const W = layer.clientWidth, Hh = layer.clientHeight;
      const move = (ev) => { const p = rel(ev); raw.push([p.x, p.y]); line.setAttribute('points', raw.map(([a, b]) => `${a * W},${b * Hh}`).join(' ')); };
      const up = () => {
        window.removeEventListener('pointermove', move);
        svg.remove();
        if (raw.length < 2) return draw();
        const xs = raw.map((q) => q[0]), ys = raw.map((q) => q[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        const w = Math.max(Math.max(...xs) - x0, 0.002), hgt = Math.max(Math.max(...ys) - y0, 0.002);
        st.items.push({ id: ++st.seq, type: 'ink', page: st.page, x: x0, y: y0, w, h: hgt, color: st.color, width: st.inkWidth / Hh,
          points: raw.map(([a, b]) => [(a - x0) / w, (b - y0) / hgt]) });
        draw(); mountTools();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      e.preventDefault();
      return;
    }
    // rect, whiteout, redact, highlight: drag out a box
    const it = { id: ++st.seq, type: tool, page: st.page, x: start.x, y: start.y, w: 0, h: 0, color: tool === 'highlight' ? HIGHLIGHT : st.color, fill: false };
    st.items.push(it);
    const move = (ev) => { const p = rel(ev); it.x = Math.min(start.x, p.x); it.y = Math.min(start.y, p.y); it.w = Math.abs(p.x - start.x); it.h = Math.abs(p.y - start.y); draw(); };
    const up = () => { window.removeEventListener('pointermove', move); if (it.w < 0.01 || it.h < 0.006) st.items = st.items.filter((i) => i !== it); else st.sel = it.id; draw(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    e.preventDefault();
  });
  function remove(it) {
    if (!it) return;
    st.items = st.items.filter((i) => i !== it && i.id !== it.patch);
    st.sel = null;
    mountTools();
  }

  /** Swap a line of existing text for an editable copy sitting on a white patch. */
  function editLine(i) {
    const l = (st.lines.get(st.page) || [])[i];
    if (!l) return;
    const pad = l.size * 0.12;
    const patch = { id: ++st.seq, type: 'whiteout', page: st.page, x: l.x - pad * 0.5, y: l.y - pad * 0.5, w: l.w + pad, h: l.h + pad * 0.6, line: i, auto: true };
    // text boxes are positioned by their top edge; put the baseline back where it was
    const it = { id: ++st.seq, type: 'text', page: st.page, x: l.x - 2 / layer.clientWidth, y: l.base - l.size * 1.02 - 2 / layer.clientHeight, w: 0, h: 0,
      text: l.text, color: '#000000', fontSize: l.size, font: l.font, line: i, patch: patch.id };
    st.items.push(patch, it);
    st.sel = it.id;
    draw(); mountTools();
    const ed = layer.querySelector(`[data-id="${it.id}"] .it-edit`);
    ed.focus();
    document.getSelection().selectAllChildren(ed);
  }

  layer.addEventListener('input', (e) => { const it = byEl(e.target.closest('.it')); if (it) it.text = e.target.innerText.replace(/\n$/, ''); });
  window.addEventListener('keydown', (e) => {
    if (!layer.isConnected || !st.sel) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('[contenteditable],input,textarea')) {
      const it = st.items.find((i) => i.id === st.sel);
      if (it && it.type !== 'crop') { remove(it); draw(); e.preventDefault(); }
    }
  });

  stage.querySelector('.ed-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    const n = st.page + Number(b.dataset.nav);
    if (n >= 0 && n < file.pageCount) { st.page = n; st.sel = null; show(); }
  });

  /* ---- image picker and signature pad ---- */
  const imgInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
  stage.append(imgInput);
  imgInput.addEventListener('change', async () => {
    const f = imgInput.files[0];
    if (!f) return;
    const bmp = await createImageBitmap(f);
    st.image = { url: URL.createObjectURL(f), bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type, w: bmp.width, h: bmp.height };
    st.active = 'image';
    mountTools();
  });

  function openSignature() {
    const d = document.createElement('dialog');
    d.className = 'modal sig';
    d.innerHTML = `<form method="dialog">
      <h3>${icon('pen', 18)} Your signature</h3>
      <div class="seg"><label><input type="radio" name="m" value="draw" checked/><span>Draw</span></label><label><input type="radio" name="m" value="type"/><span>Type</span></label></div>
      <canvas class="sig-pad" width="640" height="220" aria-label="Signature drawing area"></canvas>
      <input class="sig-type" type="text" placeholder="Type your name" hidden aria-label="Your name"/>
      <div class="row end"><button type="button" class="btn btn-ghost" data-clear>Clear</button><button class="btn btn-ghost" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Use signature</button></div>
    </form>`;
    document.body.append(d);
    const pad = d.querySelector('.sig-pad'), typed = d.querySelector('.sig-type'), ctx = pad.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a';
    let drawing = false, dirty = false;
    const pt = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
    pad.addEventListener('pointerdown', (e) => { drawing = true; dirty = true; pad.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pt(e)); });
    pad.addEventListener('pointermove', (e) => { if (drawing) { ctx.lineTo(...pt(e)); ctx.stroke(); } });
    pad.addEventListener('pointerup', () => { drawing = false; });
    d.querySelector('[data-clear]').onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); dirty = false; typed.value = ''; };
    d.querySelectorAll('[name=m]').forEach((r) => r.addEventListener('change', () => { const t = r.value === 'type'; pad.hidden = t; typed.hidden = !t; if (t) typed.focus(); }));
    d.addEventListener('close', async () => {
      const mode = d.querySelector('[name=m]:checked').value;
      d.remove();
      if (d.returnValue !== 'ok') return;
      if (mode === 'type') {
        if (!typed.value.trim()) return;
        ctx.clearRect(0, 0, pad.width, pad.height);
        await document.fonts.load('600 96px Caveat').catch(() => {});
        ctx.fillStyle = '#0f172a'; ctx.textBaseline = 'middle';
        let size = 110;
        do { ctx.font = `600 ${size}px Caveat, "Brush Script MT", cursive`; size -= 6; } while (ctx.measureText(typed.value).width > pad.width - 40 && size > 30);
        ctx.fillText(typed.value, 20, pad.height / 2);
      } else if (!dirty) return;
      const trimmed = trim(pad);
      const blob = await new Promise((r) => trimmed.toBlob(r, 'image/png'));
      st.signature = { url: URL.createObjectURL(blob), bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', w: trimmed.width, h: trimmed.height };
      st.active = 'signature';
      mountTools();
    });
    d.showModal();
  }

  function trim(canvas) {
    const { width: w, height: hh } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, w, hh).data;
    let x0 = w, y0 = hh, x1 = 0, y1 = 0;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 <= x0 || y1 <= y0) return canvas;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 12; out.height = y1 - y0 + 12;
    out.getContext('2d').drawImage(canvas, x0 - 6, y0 - 6, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /* ---- tool palette in the side panel ---- */
  function mountTools() {
    const host = document.getElementById('editor-tools');
    if (!host) return;
    const showStyle = palette.includes('text') || palette.includes('rect');
    const tip = { edittext: 'Click any line of text on the page to change it.', ink: 'Drag on the page to draw.', highlight: 'Drag over the text you want to highlight.' }[st.active];
    host.innerHTML = `
      ${palette.length > 1 ? `<div class="field"><span>Tool</span><div class="tool-grid">${palette.map((p) => `<button type="button" class="tool-btn" data-tool="${p}" aria-pressed="${st.active === p}">${icon(LABELS[p][0], 18)}<span>${LABELS[p][1]}</span></button>`).join('')}</div></div>` : ''}
      ${palette.includes('signature') ? `<div class="field"><span>Signature</span>${st.signature ? `<img class="sig-preview" src="${st.signature.url}" alt="Your signature"/>` : ''}<button type="button" class="btn btn-ghost" data-sig>${st.signature ? 'Change signature' : 'Create signature'}</button></div>` : ''}
      ${showStyle ? `<div class="row"><label class="field"><span>Colour</span><input type="color" data-st="color" value="${st.color}"/></label>
        <label class="field grow"><span>Text size</span><input type="number" data-st="fontSize" min="6" max="96" value="${st.fontSize}"/></label></div>` : ''}
      ${palette.includes('ink') ? `<label class="field"><span>Pen width</span><input type="range" data-st="inkWidth" min="1" max="14" step="1" value="${st.inkWidth}"/></label>` : ''}
      ${palette.includes('rect') ? `<label class="check"><input type="checkbox" data-st="fill" ${st.fill ? 'checked' : ''}/> <span>Fill shapes</span></label>` : ''}
      ${tip ? `<p class="note">${tip}</p>` : ''}
      <p class="note small">${countText()}Select an item and press Delete to remove it.</p>`;
    host.onclick = (e) => {
      const t = e.target.closest('[data-tool]');
      if (t) {
        st.active = t.dataset.tool;
        if (st.active === 'image') imgInput.click();
        if (st.active === 'signature' && !st.signature) openSignature();
        mountTools(); draw();
      }
      if (e.target.closest('[data-sig]')) openSignature();
    };
    host.oninput = (e) => {
      const k = e.target.dataset.st;
      if (!k) return;
      e.stopPropagation();
      st[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) || 16 : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
      const it = st.items.find((i) => i.id === st.sel);
      if (it) {
        if (k === 'color' && it.type !== 'highlight' && it.type !== 'whiteout') it.color = st.color;
        if (k === 'inkWidth' && it.type === 'ink') it.width = st.inkWidth / pageEl.clientHeight;
        if (k === 'fontSize' && it.type === 'text') it.fontSize = st.fontSize / 792;
        if (k === 'fill' && it.type === 'rect') it.fill = st.fill;
        draw();
      }
    };
    host.onchange = (e) => e.stopPropagation();
  }

  function countText() {
    const n = st.items.filter((i) => i.type !== 'crop' && !i.auto).length;
    return n ? `${n} change${n === 1 ? '' : 's'} so far. ` : '';
  }

  /** Items ready for export. Text boxes are measured from the DOM so line breaks match. */
  async function collect() {
    const H = pageEl.clientHeight, W = pageEl.clientWidth;
    return st.items.filter((i) => i.type !== 'text' || i.text.trim()).map((i) => {
      if (i.type === 'ink') return { ...i };
      if (i.type !== 'text') return { ...i, fill: i.type === 'rect' ? i.fill : true };
      const lines = i.text.split('\n').length;
      const px = i.fontSize * H;
      return { ...i, w: i.w || 0.3, h: (lines * px * 1.2) / H, x: i.x + 2 / W, y: i.y + 2 / H, fontSize: i.fontSize };
    });
  }

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => layer.isConnected && show(), 150); });
  show().then(mountTools);
  return { collect, page: () => st.page, mountTools };
}
