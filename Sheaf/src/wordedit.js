// The Edit Word workspace: a thin Sheaf bar over the WordCraft editor, which fills the rest of
// the screen. WordCraft brings its own ribbon (Home, Insert, Design, Layout, References, Review,
// View), so this file only opens the document, saves what it hands back, and guards leaving.
import { mountEditor, canRunEditor, editorInstalled } from './lib/wordcraft.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountWordEditor(root, session, { icon, toast, deliver }) {
  const file = session.files[0]?.file || null;
  let name = file?.name || 'Document.docx';
  let ed = null;
  // On phones WebGPU is often advertised and then fails, so start on WebGL2 there.
  const webgl = matchMedia('(pointer: coarse)').matches;

  root.innerHTML = `
    <div class="word-bar">
      <a class="back" href="#/" aria-label="All tools">${icon('arrowLeft', 18)}<span class="word-bar-label">All tools</span></a>
      <span class="word-name" title="${esc(name)}">${icon('fileWord', 18)}<b>${esc(name)}</b><i class="word-dirty" hidden title="Unsaved changes">Unsaved</i></span>
      <span class="word-actions">
        <button class="btn btn-ghost" id="wc-pdf" type="button" disabled>${icon('download', 18)}<span class="word-bar-label">PDF</span></button>
        <button class="btn btn-cta" id="wc-save" type="button" disabled>${icon('save', 18)}<span>Save</span></button>
      </span>
    </div>
    <div class="word-host"><div class="word-wait" role="status"><div class="spinner"></div><p>Starting the editor…</p></div></div>`;
  const host = root.querySelector('.word-host');
  const dirtyMark = root.querySelector('.word-dirty');
  const nameEl = root.querySelector('.word-name b');
  const saveBtn = root.querySelector('#wc-save');
  const pdfBtn = root.querySelector('#wc-pdf');

  const fail = (title, body) => {
    host.innerHTML = `<div class="word-fail"><span class="card-icon">${icon('fileWord', 28)}</span><h2>${title}</h2><p>${body}</p><a class="btn btn-ghost" href="#/">All tools</a></div>`;
  };

  (async () => {
    if (!canRunEditor()) {
      return fail('This browser cannot run the editor', 'The Word editor draws with WebGPU or WebGL2, and this browser has neither turned on. Recent Chrome, Edge, Firefox and Safari all have them.');
    }
    if (!(await editorInstalled())) {
      return fail('The Word editor is not installed', 'This copy of Sheaf was built without it. Run <code>scripts/build-wordcraft.sh</code> in the Sheaf folder, then build Sheaf again.');
    }
    ed = mountEditor(host, {
      file: session.blank ? null : file,
      webgl,
      onReady: () => {
        host.querySelector('.word-wait')?.remove();
        saveBtn.disabled = pdfBtn.disabled = false;
      },
      onDirty: (d) => { dirtyMark.hidden = !d; },
      onFailed: (msg) => fail('The editor could not start', `${esc(msg)}. Try another browser, or update this one.`),
      onSave: (out) => {
        // A save in a document format names the file being edited: after Save As, or after
        // a file was opened from the editor's own File menu. PDFs and other exports are copies.
        if (out.saveAs || /\.(docx|docm|dotx|dotm|odt|ott|rtf)$/i.test(out.name)) { name = out.name; nameEl.textContent = name; }
        deliver(out);
      },
    });
  })();

  const run = async (id) => {
    try { await ed?.command(id, {}); }
    catch (e) { toast(e.message || 'That did not work.'); }
  };
  saveBtn.addEventListener('click', () => run('file.save'));
  pdfBtn.addEventListener('click', () => run('file.exportPdf'));

  return {
    dirty: () => !!ed?.dirty(),
    destroy: () => { ed?.destroy(); ed = null; },
  };
}
