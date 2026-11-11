import './style.css';
import JSZip from 'jszip';
import { TOOLS, CATEGORIES, byId } from './tools.js';
import { icon } from './lib/icons.js';
import { readBytes, openForRender, renderPage, formatBytes, parseRanges, baseName, loadPdf } from './lib/pdf.js';
import * as ops from './lib/ops.js';
import * as conv from './lib/convert.js';
import { mountCanvasEditor } from './editor.js';

const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let uid = 0;
let session = null; // state of the tool currently open

/* ------------------------------------------------------------------ shell */
function shell(inner) {
  app.innerHTML = `
    <header class="top">
      <a class="brand" href="#/" aria-label="Sheaf home">
        <span class="brand-mark">${icon('file', 18)}</span><span>Sheaf</span>
      </a>
      <nav class="top-nav" aria-label="Popular tools">
        <a href="#/merge">Merge</a><a href="#/split">Split</a><a href="#/compress">Compress</a>
        <a href="#/edit">Edit</a><a href="#/sign">Sign</a><a href="#/">All tools</a>
      </nav>
      <span class="private">${icon('shield', 16)} Files stay on your device</span>
    </header>
    <main id="main">${inner}</main>
    <footer class="foot">Everything runs in your browser. Nothing is uploaded.</footer>`;
}

function toast(msg, kind = 'error') {
  document.querySelector('.toast')?.remove();
  const el = h(`<div class="toast ${kind}" role="alert">${esc(msg)}</div>`);
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}

/* ------------------------------------------------------------------- home */
function home() {
  session = null;
  shell(`
    <section class="hero">
      <h1>Every PDF job, done in your browser</h1>
      <p>Merge, split, compress, convert, sign and lock your PDFs. No account, no upload, no waiting on a server.</p>
    </section>
    <div class="filters" role="tablist" aria-label="Tool categories">
      ${CATEGORIES.map((c, i) => `<button role="tab" class="chip" aria-selected="${i === 0}" data-cat="${c.id}">${c.label}</button>`).join('')}
    </div>
    <section class="grid" aria-label="Tools">
      ${TOOLS.map((t) => `
        <a class="card hue-${t.hue}" href="#/${t.id}" data-cat="${t.cat}">
          <span class="card-icon">${icon(t.icon, 24)}</span>
          <h2>${t.title}</h2>
          <p>${t.desc}</p>
        </a>`).join('')}
    </section>`);
  $('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-selected', c === b));
    document.querySelectorAll('.card').forEach((c) => { c.hidden = b.dataset.cat !== 'all' && c.dataset.cat !== b.dataset.cat; });
  });
}

/* ------------------------------------------------------------ upload step */
function openTool(tool) {
  session = { tool, files: [], opts: defaults(tool), pages: [], selected: new Set() };
  shell(`
    <section class="upload hue-${tool.hue}">
      <a class="back" href="#/">${icon('arrowLeft', 16)} All tools</a>
      <h1>${tool.title}</h1>
      <p>${tool.desc}</p>
      <label class="btn btn-cta btn-xl">
        ${icon('upload', 22)} ${pickLabel(tool)}
        <input type="file" class="sr" accept="${tool.accept}" ${tool.multiple ? 'multiple' : ''} />
      </label>
      ${tool.capture ? `<label class="btn btn-ghost">${icon('camera', 18)} Use camera<input type="file" class="sr" accept="image/*" capture="environment" /></label>` : ''}
      <p class="hint">or drop ${tool.mode === 'images' ? 'images' : 'PDFs'} anywhere on this page</p>
    </section>`);
  document.querySelectorAll('.upload input[type=file]').forEach((inp) =>
    inp.addEventListener('change', () => addFiles([...inp.files])));
}

const pickLabel = (t) => t.mode === 'images' ? 'Select images' : t.multiple ? 'Select PDF files' : 'Select PDF file';

function defaults(tool) {
  const o = { ...(tool.fixed || {}) };
  for (const f of tool.fields || []) if ('default' in f) o[f.key] = f.default;
  return o;
}

function matches(file, tool) {
  if (tool.mode === 'images') return file.type.startsWith('image/');
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function askPassword(name, wrong) {
  return new Promise((resolve) => {
    const d = h(`<dialog class="modal"><form method="dialog">
      <h3>${icon('lock', 18)} This PDF is locked</h3>
      <p>${wrong ? 'That password did not work. Try again for' : 'Enter the password for'} <b>${esc(name)}</b>.</p>
      <label class="field"><span>Password</span><input type="password" name="pw" autocomplete="off" required /></label>
      <div class="row end"><button class="btn btn-ghost" value="cancel" formnovalidate>Skip file</button><button class="btn btn-primary" value="ok">Open</button></div>
    </form></dialog>`);
    document.body.append(d);
    d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? $('input', d).value : null; d.remove(); resolve(v); });
    d.showModal();
  });
}

async function openPdfFile(file) {
  const bytes = await readBytes(file);
  const rec = { id: ++uid, name: file.name, size: file.size, bytes, rotation: 0, password: undefined, locked: false };
  let wrong = false;
  for (;;) {
    try {
      rec.pdf = await openForRender(bytes, rec.password);
      rec.pageCount = rec.pdf.numPages;
      return rec;
    } catch (e) {
      if (e?.name === 'PasswordException') {
        rec.locked = true;
        const pw = await askPassword(file.name, wrong);
        if (pw === null) return null;
        rec.password = pw; wrong = true;
        continue;
      }
      if (session.tool.lenient) { rec.broken = true; rec.pageCount = 0; return rec; }
      throw new Error(`${file.name} could not be read. It may be damaged, try Repair PDF.`);
    }
  }
}

async function addFiles(list) {
  if (!session) return;
  const { tool } = session;
  const ok = list.filter((f) => matches(f, tool));
  if (!ok.length) return toast(tool.mode === 'images' ? 'Those are not image files.' : 'Please choose PDF files.');
  const firstBatch = session.files.length === 0;
  if (firstBatch) app.querySelector('.upload')?.classList.add('busy');
  for (const f of ok) {
    if (tool.max && session.files.length >= tool.max) break;
    if (!tool.multiple && session.files.length) break;
    try {
      if (tool.mode === 'images') {
        session.files.push({ id: ++uid, name: f.name, size: f.size, file: f, url: URL.createObjectURL(f) });
      } else {
        const rec = await openPdfFile(f);
        if (!rec) continue;
        const fileIdx = session.files.push(rec) - 1;
        for (let i = 0; i < rec.pageCount; i++) session.pages.push({ id: ++uid, fileIdx, index: i, rotation: 0 });
      }
    } catch (e) { toast(e.message); }
  }
  app.querySelector('.upload')?.classList.remove('busy');
  if (session.files.length) workspace();
}

/* -------------------------------------------------------------- workspace */
function workspace() {
  const { tool } = session;
  shell(`
    <div class="work hue-${tool.hue}">
      <section class="stage" aria-label="Your files"></section>
      <aside class="panel">
        <h1>${tool.title}</h1>
        <div class="panel-body"></div>
        <div class="panel-foot">
          <button class="btn btn-cta btn-block" id="run">${tool.action} ${icon('chevronRight', 18)}</button>
        </div>
      </aside>
    </div>`);
  renderFields();
  renderStage();
  $('#run').addEventListener('click', run);
}

function renderFields() {
  const { tool, opts } = session;
  const body = $('.panel-body');
  const fields = (tool.fields || []).filter((f) => !f.when || f.when(opts));
  const intro = {
    merge: 'Drag the files to set the order. Add more with the plus button.',
    remove: 'Click the pages you want to delete.',
    extract: 'Click the pages you want to keep.',
    organize: 'Drag pages to reorder them. Use the buttons on each page to rotate or delete.',
    rotate: 'Rotate everything at once, or turn single files with the button on each one.',
    unlock: 'Locked files ask for their password when you add them. The saved copy opens without one.',
    repair: 'We will rebuild the file structure. If that fails, pages are recovered as images.',
    redact: 'Drag over anything you want gone. Redacted pages are flattened to images so the content cannot be recovered.',
    edit: 'Edit text is on to start: click any line on the page to retype it. The other tools add new things on top.',
    sign: 'Create your signature, then click where it should go.',
    crop: 'Drag the corners of the frame to choose what to keep.',
    compare: 'Removed words are marked on the left, added words on the right.',
    ocr: 'Pages are read at 300 dpi on this device. A big scan can take a minute or two.',
    'pdf-to-word': 'Text, headings and lists come across as editable Word text. Images and exact positions are not kept.',
    'pdf-to-excel': 'Works best on PDFs made from spreadsheets or reports. Numbers become real numbers you can add up.',
    'pdf-to-powerpoint': 'Each page becomes one slide, shown as a picture of the page.',
    summarize: 'Summarizer' in self ? 'Your browser has an on-device model, so the summary is written fresh.' : 'Key sentences are picked from the text. Scanned PDFs need OCR first.',
    translate: conv.translatorSupported() ? 'Translation runs on this device. The first time you use a language pair, the browser downloads it once.' : 'This browser has no on-device translator. Chrome 138 or newer on a desktop has one built in.',
  }[tool.id];
  body.innerHTML = (intro ? `<p class="note">${intro}</p>` : '') + fields.map(fieldHtml).join('') +
    (tool.rotatable ? `<div class="field"><span>Rotate all</span><div class="row">
      <button class="btn btn-ghost" data-rot="-90">${icon('rotateLeft', 18)} Left</button>
      <button class="btn btn-ghost" data-rot="90">${icon('rotate', 18)} Right</button></div></div>` : '') +
    (tool.mode === 'canvas' ? '<div id="editor-tools"></div>' : '');
  body.oninput = body.onchange = (e) => {
    const el = e.target.closest('[data-key]');
    if (!el) return;
    const k = el.dataset.key;
    if (el.type === 'checkbox') opts[k] = el.checked;
    else if (el.type === 'file') opts[k] = el.files[0] || null;
    else if (el.type === 'radio') { if (el.checked) opts[k] = el.value; }
    else opts[k] = el.value;
    if (e.type === 'change' && (tool.fields || []).some((f) => f.when)) { renderFields(); if (session.editor) session.editor.mountTools(); }
    if (tool.mode === 'pages' && tool.id === 'split') markSplit();
  };
  body.onclick = (e) => {
    const r = e.target.closest('[data-rot]');
    if (r) { session.files.forEach((f) => { f.rotation = (f.rotation + Number(r.dataset.rot) + 360) % 360; }); renderStage(); }
  };
}

function fieldHtml(f) {
  const v = session.opts[f.key];
  const id = `f-${f.key}`;
  const hint = f.hint ? `<small>${f.hint}</small>` : '';
  switch (f.type) {
    case 'checkbox':
      return `<label class="check"><input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''}/> <span>${f.label}</span></label>`;
    case 'select':
      return `<label class="field" for="${id}"><span>${f.label}</span><select id="${id}" data-key="${f.key}">${f.options.map(([val, l]) => `<option value="${esc(val)}" ${String(v) === val ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    case 'segmented':
      return `<fieldset class="field"><legend>${f.label}</legend><div class="seg">${f.options.map(([val, l]) => `<label><input type="radio" name="${id}" data-key="${f.key}" value="${val}" ${v === val ? 'checked' : ''}/><span>${l}</span></label>`).join('')}</div></fieldset>`;
    case 'cards':
      return `<fieldset class="field"><legend>${f.label}</legend><div class="opt-cards">${f.options.map(([val, l, d]) => `<label><input type="radio" name="${id}" data-key="${f.key}" value="${val}" ${v === val ? 'checked' : ''}/><span><b>${l}</b><em>${d}</em></span></label>`).join('')}</div></fieldset>`;
    case 'grid': {
      const cells = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
      return `<fieldset class="field"><legend>${f.label}</legend><div class="pos-grid">${cells.map((c) => `<label title="${c.replace('-', ' ')}"><input type="radio" name="${id}" data-key="${f.key}" value="${c}" ${v === c ? 'checked' : ''}/><span class="sr">${c.replace('-', ' ')}</span><i></i></label>`).join('')}</div></fieldset>`;
    }
    case 'range':
      return `<label class="field" for="${id}"><span>${f.label}</span><input id="${id}" type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"/></label>`;
    case 'file':
      return `<label class="field" for="${id}"><span>${f.label}</span><input id="${id}" type="file" data-key="${f.key}" accept="${f.accept}"/></label>`;
    default:
      return `<label class="field" for="${id}"><span>${f.label}</span><input id="${id}" type="${f.type}" data-key="${f.key}" value="${esc(v ?? '')}" ${f.placeholder ? `placeholder="${f.placeholder}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.type === 'password' ? 'autocomplete="new-password"' : ''}/>${hint}</label>`;
  }
}

/* ------------------------------------------------------------------ stage */
function addButton() {
  const { tool } = session;
  if (!tool.multiple || (tool.max && session.files.length >= tool.max)) return '';
  return `<label class="add-more" title="Add more files">${icon('plus', 22)}<span class="sr">Add more files</span>
    <input type="file" class="sr" accept="${tool.accept}" multiple /></label>`;
}

function renderStage() {
  const { tool } = session;
  const stage = $('.stage');
  if (!stage) return;
  if (tool.mode === 'canvas') {
    if (!session.editor) session.editor = mountCanvasEditor(stage, session, { icon, renderPage });
    return;
  }
  if (tool.mode === 'compare') return renderCompare(stage);
  if (tool.mode === 'pages') return renderPages(stage);

  stage.innerHTML = `<div class="tiles">${session.files.map((f, i) => `
    <figure class="tile" draggable="${tool.sortable || tool.mode === 'images'}" data-i="${i}">
      <div class="thumb" data-thumb="${f.id}">${f.url ? `<img src="${f.url}" alt="" />` : f.broken ? icon('wrench', 32) : ''}</div>
      <figcaption title="${esc(f.name)}">${esc(f.name)}</figcaption>
      <small>${f.pageCount != null && !f.broken ? `${f.pageCount} page${f.pageCount === 1 ? '' : 's'} · ` : ''}${formatBytes(f.size)}${f.locked ? ' · locked' : ''}</small>
      <div class="tile-actions">
        ${tool.rotatable ? `<button data-act="rot" title="Rotate" aria-label="Rotate ${esc(f.name)}">${icon('rotate', 16)}</button>` : ''}
        <button data-act="del" title="Remove" aria-label="Remove ${esc(f.name)}">${icon('x', 16)}</button>
      </div>
    </figure>`).join('')}</div>${addButton()}`;
  session.files.forEach((f) => { if (f.pdf) thumb(f.pdf, 1, $(`[data-thumb="${f.id}"]`, stage), f.rotation); });
  stage.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = Number(b.closest('.tile').dataset.i);
    if (b.dataset.act === 'del') {
      session.files.splice(i, 1);
      if (!session.files.length) return openTool(tool);
    } else session.files[i].rotation = (session.files[i].rotation + 90) % 360;
    renderStage();
  };
  sortable(stage, '.tile', (from, to) => { const [m] = session.files.splice(from, 1); session.files.splice(to, 0, m); renderStage(); });
  wireAdd(stage);
}

function wireAdd(stage) {
  $('.add-more input', stage)?.addEventListener('change', (e) => addFiles([...e.target.files]));
}

const thumbQueue = [];
let thumbBusy = false;
function thumb(pdf, n, holder, rotation = 0) {
  if (!holder) return;
  thumbQueue.push({ pdf, n, holder, rotation });
  if (!thumbBusy) drain();
}
async function drain() {
  thumbBusy = true;
  while (thumbQueue.length) {
    const { pdf, n, holder, rotation } = thumbQueue.shift();
    if (!holder.isConnected) continue;
    try { holder.replaceChildren(await renderPage(pdf, n, { maxWidth: 260, rotation })); } catch { /* leave blank */ }
  }
  thumbBusy = false;
}

function sortable(root, sel, move) {
  let from = null;
  root.ondragstart = (e) => { const t = e.target.closest(sel); if (t) { from = Number(t.dataset.i); e.dataTransfer.effectAllowed = 'move'; t.classList.add('dragging'); } };
  root.ondragend = () => { from = null; root.querySelectorAll('.dragging,.over').forEach((n) => n.classList.remove('dragging', 'over')); };
  root.ondragover = (e) => { const t = e.target.closest(sel); if (from !== null && t) { e.preventDefault(); root.querySelectorAll('.over').forEach((n) => n.classList.remove('over')); t.classList.add('over'); } };
  root.ondrop = (e) => {
    const t = e.target.closest(sel);
    if (from === null || !t) return;
    e.preventDefault(); e.stopPropagation();
    const to = Number(t.dataset.i);
    if (to !== from) move(from, to);
  };
}

/* ------------------------------------------------------------- page grid */
function renderPages(stage) {
  const { tool, pages, selected } = session;
  const organize = tool.select === 'organize';
  stage.innerHTML = `<div class="tiles pages">${pages.map((p, i) => `
    <figure class="tile page ${selected.has(p.id) ? `sel sel-${tool.select}` : ''}" data-i="${i}" draggable="${organize}" tabindex="0"
      role="${tool.select === 'none' || organize ? 'group' : 'checkbox'}" aria-checked="${selected.has(p.id)}" aria-label="Page ${i + 1}">
      <div class="thumb" data-thumb="${p.id}"></div>
      <figcaption>${organize && session.files.length > 1 ? `${String.fromCharCode(65 + p.fileIdx)}${p.index + 1}` : p.index + 1}</figcaption>
      ${organize ? `<div class="tile-actions"><button data-act="rot" aria-label="Rotate page ${i + 1}">${icon('rotate', 16)}</button><button data-act="del" aria-label="Delete page ${i + 1}">${icon('x', 16)}</button></div>` : ''}
    </figure>`).join('')}</div>${organize ? addButton() : ''}`;
  pages.forEach((p) => thumb(session.files[p.fileIdx].pdf, p.index + 1, $(`[data-thumb="${p.id}"]`, stage), p.rotation));
  const toggle = (tile) => {
    if (tool.select !== 'remove' && tool.select !== 'keep') return;
    const p = pages[Number(tile.dataset.i)];
    selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id);
    tile.className = `tile page ${selected.has(p.id) ? `sel sel-${tool.select}` : ''}`;
    tile.setAttribute('aria-checked', selected.has(p.id));
  };
  stage.onclick = (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const b = e.target.closest('[data-act]');
    if (!b) return toggle(tile);
    const i = Number(tile.dataset.i);
    if (b.dataset.act === 'del') pages.splice(i, 1); else pages[i].rotation = (pages[i].rotation + 90) % 360;
    renderPages(stage);
  };
  stage.onkeydown = (e) => { if ((e.key === ' ' || e.key === 'Enter') && e.target.matches('.tile')) { e.preventDefault(); toggle(e.target); } };
  if (organize) { sortable(stage, '.tile', (from, to) => { const [m] = pages.splice(from, 1); pages.splice(to, 0, m); renderPages(stage); }); wireAdd(stage); }
  if (tool.id === 'split') markSplit();
}

function splitGroups() {
  const o = session.opts, n = session.files[0].pageCount;
  if (o.how === 'every') return Array.from({ length: n }, (_, i) => [i]);
  if (o.how === 'fixed') {
    const size = Math.max(1, parseInt(o.chunk, 10) || 1), g = [];
    for (let i = 0; i < n; i += size) g.push(Array.from({ length: Math.min(size, n - i) }, (_, k) => i + k));
    return g;
  }
  return parseRanges(o.ranges, n);
}

function markSplit() {
  let groups = [];
  try { groups = splitGroups(); } catch { /* shown on run */ }
  const of = new Map();
  groups.forEach((g, gi) => g.forEach((i) => { if (!of.has(i)) of.set(i, gi); }));
  document.querySelectorAll('.tile.page').forEach((t, i) => {
    t.classList.toggle('grp', of.has(i));
    t.style.setProperty('--g', of.has(i) ? of.get(i) % 6 : 0);
    t.classList.toggle('grp-end', of.has(i) && of.get(i) !== of.get(i + 1));
  });
}

/* ---------------------------------------------------------------- compare */
async function renderCompare(stage) {
  const [a, b] = session.files;
  if (!b) {
    stage.innerHTML = `<div class="empty"><p>Add the second version to compare against <b>${esc(a.name)}</b>.</p>${addButton()}</div>`;
    return wireAdd(stage);
  }
  stage.innerHTML = '<div class="empty"><div class="spinner"></div><p>Reading both files…</p></div>';
  const text = async (f) => (await ops.extractLines(f.pdf)).map((ls) => ls.map((l) => l.text).join(' '));
  const [ta, tb] = [await text(a), await text(b)];
  const n = Math.max(ta.length, tb.length);
  let added = 0, removed = 0, html = '';
  for (let i = 0; i < n; i++) {
    const d = ops.diffWords(ta[i] || '', tb[i] || '');
    const side = (keep) => d.filter((x) => x.op === 'eq' || x.op === keep).map((x) => x.op === 'eq' ? esc(x.text) : `<mark class="${x.op}">${esc(x.text)}</mark>`).join(' ') || '<i class="muted">No text on this page</i>';
    d.forEach((x) => { const c = x.text.split(' ').length; if (x.op === 'add') added += c; if (x.op === 'del') removed += c; });
    html += `<div class="cmp-row"><div class="cmp-head">Page ${i + 1}</div><div class="cmp-col">${side('del')}</div><div class="cmp-col">${side('add')}</div></div>`;
  }
  stage.innerHTML = `<div class="cmp">
    <div class="cmp-row cmp-names"><div class="cmp-col"><b>${esc(a.name)}</b></div><div class="cmp-col"><b>${esc(b.name)}</b></div></div>${html}</div>`;
  session.compare = { added, removed };
  const btn = $('#run');
  if (btn) btn.hidden = true;
  $('.panel-body').insertAdjacentHTML('beforeend', `<div class="stats"><div><b class="del-t">${removed}</b><span>words removed</span></div><div><b class="add-t">${added}</b><span>words added</span></div></div>
    ${added + removed === 0 ? '<p class="note">The text of both files is identical.</p>' : ''}`);
}

/* -------------------------------------------------------------------- run */
async function run() {
  const { tool, files, opts } = session;
  const btn = $('#run');
  try {
    validate();
    btn.disabled = true;
    const overlay = h(`<div class="busy-overlay" role="status"><div class="spinner"></div><p>${busyText(tool)}</p><div class="bar"><i></i></div></div>`);
    document.body.append(overlay);
    const progress = (p) => { $('.bar i', overlay).style.width = `${Math.round(p * 100)}%`; };
    let outputs = [], summary = '', preview = null;
    try {
      ({ outputs, summary = '', preview = null } = await execute(tool, files, opts, progress));
    } finally { overlay.remove(); }
    done(outputs, summary, preview);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something went wrong with that file.');
  } finally { if (btn) btn.disabled = false; }
}

const langName = (c) => byId.translate.fields[1].options.find(([k]) => k === c)?.[1] || c;
const busyText = (t) => t.busy || `${t.action.replace(/ PDFs?$/, '')}ing…`.replace('eing', 'ing').replace(/^(Split|Crop)ing/, '$1ting').replace('Cropting', 'Cropping');

function validate() {
  const { tool, files, opts, selected, pages } = session;
  if (tool.min && files.length < tool.min) throw new Error(`Add at least ${tool.min} files first.`);
  if (tool.id === 'protect') {
    if (!opts.password) throw new Error('Choose a password first.');
    if (opts.password !== opts.confirm) throw new Error('The two passwords do not match.');
  }
  if (tool.select === 'remove') {
    if (!selected.size) throw new Error('Click the pages you want to remove.');
    if (selected.size === pages.length) throw new Error('You cannot remove every page.');
  }
  if (tool.select === 'keep' && !selected.size) throw new Error('Click the pages you want to extract.');
  if (tool.id === 'split' && opts.how === 'ranges' && !opts.ranges.trim()) throw new Error('Type the page ranges to split out, such as 1-3, 4-6.');
  if (tool.id === 'watermark' && opts.kind === 'image' && !opts.image) throw new Error('Choose an image for the watermark.');
  if (tool.id === 'unlock' && !files.some((f) => f.locked)) {
    // Owner-locked files open without a prompt but still carry restrictions; saving clears them.
  }
}

async function execute(tool, files, opts, progress) {
  const each = async (fn) => {
    const res = [];
    for (let i = 0; i < files.length; i++) {
      res.push(...await fn(files[i], (p) => progress((i + p) / files.length)));
      progress((i + 1) / files.length);
    }
    return res;
  };
  const f0 = files[0];
  switch (tool.id) {
    case 'merge': return { outputs: await ops.merge(files) };
    case 'split': return { outputs: await ops.splitGroups(f0, splitGroups(), { mergeAll: opts.how === 'ranges' && opts.mergeAll }) };
    case 'remove': {
      const keep = session.pages.filter((p) => !session.selected.has(p.id));
      return { outputs: await ops.rebuild(files, keep, `${baseName(f0.name)}-trimmed.pdf`) };
    }
    case 'extract': {
      const keep = session.pages.filter((p) => session.selected.has(p.id));
      if (opts.separate) return { outputs: await ops.splitGroups(f0, keep.map((p) => [p.index])) };
      return { outputs: await ops.rebuild(files, keep, `${baseName(f0.name)}-extracted.pdf`) };
    }
    case 'organize':
      if (!session.pages.length) throw new Error('There are no pages left to save.');
      return { outputs: await ops.rebuild(files, session.pages, `${baseName(f0.name)}-organized.pdf`) };
    case 'scan':
    case 'jpg-to-pdf': return { outputs: await ops.imagesToPdf(files, opts) };
    case 'compress': {
      let before = 0, after = 0;
      const outputs = await each(async (f, p) => { const r = await ops.compress(f, opts.level, p); before += r.stats.before; after += r.stats.after; return r.outputs; });
      const pct = Math.round((1 - after / before) * 100);
      return { outputs, summary: pct > 0 ? `${formatBytes(before)} down to ${formatBytes(after)}, ${pct}% smaller.` : 'This file is already as small as we can make it without hurting quality.' };
    }
    case 'repair': {
      let raster = false;
      const outputs = await each(async (f) => { const r = await ops.repair(f); raster ||= r.method === 'raster'; return r.outputs; });
      return { outputs, summary: raster ? 'The structure was too damaged to rebuild, so pages were recovered as images.' : 'The file structure was rebuilt.' };
    }
    case 'pdf-to-jpg': return { outputs: await each((f, p) => ops.pdfToImages(f, opts, p)) };
    case 'pdf-to-markdown': return { outputs: await each((f) => ops.pdfToMarkdown(f, opts)) };
    case 'pdf-to-word': return { outputs: await each((f) => conv.pdfToWord(f)) };
    case 'pdf-to-excel': return { outputs: await each((f) => conv.pdfToExcel(f, opts)) };
    case 'pdf-to-powerpoint': return { outputs: await each((f, p) => conv.pdfToPowerpoint(f, opts, p)) };
    case 'ocr': {
      let read = 0, skipped = 0;
      const outputs = await each(async (f, p) => { const r = await conv.ocr(f, opts, p); read += r.done; skipped += r.skipped; return r.outputs; });
      return { outputs, summary: `Read ${read} page${read === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} that already had text` : ''}.` };
    }
    case 'summarize': {
      const r = await conv.summarize(f0, opts);
      return { outputs: r.outputs, preview: r.preview, summary: `Made with ${r.method}.` };
    }
    case 'translate': {
      const first = await conv.readBlocks(f0);
      const sample = first.filter((b) => b.t !== 'page').map((b) => b.text).join(' ').slice(0, 2000);
      const { tr, from } = await conv.openTranslator(opts, sample, progress);
      try {
        return { outputs: await conv.translate(f0, first, opts, tr, progress), summary: `Translated from ${langName(from)} to ${langName(opts.to)} on this device.` };
      } finally { tr.destroy?.(); }
    }
    case 'rotate': {
      const out = [];
      for (const f of files) out.push(...await ops.rotateFiles([f], f.rotation));
      return { outputs: out };
    }
    case 'page-numbers': return { outputs: await ops.addPageNumbers(f0, opts) };
    case 'watermark': {
      const img = opts.kind === 'image' ? { bytes: await readBytes(opts.image), type: opts.image.type } : null;
      return { outputs: await ops.watermark(f0, opts, img) };
    }
    case 'protect': return { outputs: await each((f) => ops.protect(f, opts)) };
    case 'unlock': return { outputs: await each((f) => ops.unlock(f, f.password)) };
    case 'edit':
    case 'sign': {
      const items = await session.editor.collect();
      if (!items.length) throw new Error(tool.id === 'sign' ? 'Place your signature on the page first.' : 'Add something to the page first.');
      return { outputs: await ops.applyOverlays(f0, items, `${baseName(f0.name)}-${tool.id === 'sign' ? 'signed' : 'edited'}.pdf`) };
    }
    case 'redact': {
      const items = await session.editor.collect();
      if (!items.length) throw new Error('Drag over the areas you want to redact first.');
      return { outputs: await ops.redact(f0, items, progress) };
    }
    case 'crop': {
      const [box] = await session.editor.collect();
      return { outputs: await ops.crop(f0, box, opts.scope, session.editor.page()) };
    }
    default: throw new Error('This tool is not available yet.');
  }
}

/* ----------------------------------------------------------------- result */
async function done(outputs, summary, preview) {
  const { tool } = session;
  let file = outputs[0];
  if (outputs.length > 1) {
    const zip = new JSZip();
    const seen = new Map();
    for (const o of outputs) {
      const k = seen.get(o.name) || 0; seen.set(o.name, k + 1);
      zip.file(k ? o.name.replace(/(\.[^.]+)$/, `-${k + 1}$1`) : o.name, o.blob);
    }
    file = { name: `${tool.id}-results.zip`, blob: await zip.generateAsync({ type: 'blob' }) };
  }
  const url = URL.createObjectURL(file.blob);
  session.result = { outputs, file };
  shell(`
    <section class="upload done hue-${tool.hue}">
      <span class="done-mark">${icon('check', 30)}</span>
      <h1>${doneTitle(tool)}</h1>
      <p>${summary ? `${esc(summary)} ` : ''}${outputs.length > 1 ? `${outputs.length} files, packed into one zip.` : ''}</p>
      <a class="btn btn-cta btn-xl" id="dl" href="${url}" download="${esc(file.name)}">${icon('download', 22)} Download ${outputs.length > 1 ? 'all' : esc(file.name)}</a>
      <p class="hint">${formatBytes(file.blob.size)}</p>
      ${preview ? `<div class="preview"><h2>Key points</h2><ul>${preview.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
      <div class="row center">
        <a class="btn btn-ghost" href="#/${tool.id}" id="again">${icon('rotateLeft', 16)} Start over</a>
        <a class="btn btn-ghost" href="#/">All tools</a>
      </div>
    </section>`);
  $('#again').addEventListener('click', (e) => { e.preventDefault(); openTool(tool); });
  $('#dl').click();
}

const doneTitle = (t) => ({
  merge: 'Your PDFs are merged', split: 'Your PDF is split', remove: 'Pages removed', extract: 'Pages extracted',
  organize: 'Your PDF is reorganized', scan: 'Your scan is ready', compress: 'Your PDF is compressed', repair: 'Your PDF is repaired',
  'jpg-to-pdf': 'Your images are now a PDF', 'pdf-to-jpg': 'Your pages are now images', 'pdf-to-markdown': 'Your text is ready',
  edit: 'Your edits are saved', rotate: 'Your PDF is rotated', 'page-numbers': 'Page numbers added', watermark: 'Watermark added',
  ocr: 'Your text is readable now', 'pdf-to-word': 'Your Word file is ready', 'pdf-to-excel': 'Your spreadsheet is ready',
  'pdf-to-powerpoint': 'Your slides are ready', summarize: 'Here is the short version', translate: 'Your translation is ready',
  crop: 'Your PDF is cropped', sign: 'Your PDF is signed', protect: 'Your PDF is locked', unlock: 'Your PDF is unlocked', redact: 'Your PDF is redacted',
}[t.id] || 'All done');

/* ----------------------------------------------------------------- router */
function route() {
  document.querySelectorAll('dialog,.busy-overlay').forEach((n) => n.remove());
  const id = location.hash.replace(/^#\/?/, '');
  if (byId[id]) openTool(byId[id]); else home();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// Drop files anywhere while a tool is open.
let depth = 0;
window.addEventListener('dragenter', (e) => { if (session && e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dropping'); } });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  depth = 0; document.body.classList.remove('dropping');
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  if (session && !session.result) addFiles([...e.dataTransfer.files]);
});

// Exposed so the canvas editor can re-check the loaded document.
export { loadPdf };
route();
