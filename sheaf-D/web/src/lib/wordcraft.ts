// The Word editor is WordCraft (github.com/storytold/wordcraft, MIT OR Apache-2.0), built for
// the web and copied into web/public/wordcraft by scripts/copy-wordcraft.mjs (from Sheaf's build). It runs in an iframe
// on the same origin and talks to us with WordCraft's host messages:
//
//   wordcraft:ready  (from the editor)  it is running, send it a file
//   wordcraft:open   (to the editor)    { name, bytes }
//   wordcraft:save   (from the editor)  { name, bytes, saveAs } for every Save, Save As and Export
//   wordcraft:dirty  (from the editor)  { dirty }
//   wordcraft:failed (from the editor)  { error } when it could not start (no WebGPU or WebGL2)
//
// window.wordcraft inside the frame also takes commands (execute('file.exportPdf') and so on),
// which is how the converter below works without anyone touching the editor.

// import.meta.env is Vite's; plain Node (scripts/check-pickers.mjs imports tools.js) has none.
const BASE = `${import.meta.env?.BASE_URL ?? '/'}wordcraft/`;

type Out = { name: string; blob: Blob; saveAs: boolean };
export interface MountOptions {
  file?: File | null;
  author?: string;
  webgl?: boolean;
  onSave?: (out: Out) => void;
  onDirty?: (dirty: boolean) => void;
  onFailed?: (error: string) => void;
  onReady?: () => void;
}
export interface Editor {
  frame: HTMLIFrameElement;
  open(f: File): void;
  command(id: string, params?: Record<string, unknown>): Promise<unknown>;
  dirty(): boolean;
  destroy(): void;
}
const PREFIX = 'wordcraft:';

// What WordCraft opens. .doc is the old binary format; it opens but saves as .docx.
export const WORD_EXTS = ['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'ott', 'fodt', 'rtf', 'txt', 'md', 'html', 'htm'];
export const WORD_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'application/vnd.oasis.opendocument.text', 'application/rtf', 'text/rtf', 'text/plain', 'text/markdown', 'text/html',
  ...WORD_EXTS.map((e) => `.${e}`),
].join(',');

export const isWordFile = (file: File) => WORD_EXTS.includes((file.name.split('.').pop() || '').toLowerCase());

/** True when this browser can draw the editor at all. */
export function canRunEditor() {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return true;
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

/** Is the WordCraft build there? It isn't when someone runs Sheaf without building it first. */
export async function editorInstalled() {
  try {
    const r = await fetch(`${BASE}index.html`, { method: 'HEAD', cache: 'no-store' });
    return r.ok && !/text\/javascript/.test(r.headers.get('content-type') || '');
  } catch { return false; }
}

function frameUrl({ author, webgl }: { author?: string; webgl?: boolean } = {}) {
  const q = new URLSearchParams({ host: 'parent' });
  if (author) q.set('author', author);
  // Some phones and the Android WebView report WebGPU but fail to start it; WebGL2 always works there.
  if (webgl) q.set('webgl', '1');
  return `${BASE}index.html?${q}`;
}

/**
 * Puts the editor in `holder`. `onSave({ name, blob, saveAs })` gets every file the editor saves.
 * Returns { frame, open(file), command(id, params), dirty(), destroy() }.
 */
export function mountEditor(holder: HTMLElement, { file, author, webgl, onSave, onDirty, onFailed, onReady }: MountOptions = {}): Editor {
  const frame = document.createElement('iframe');
  frame.className = 'wordcraft-frame';
  frame.title = 'Word editor';
  frame.allow = 'clipboard-read; clipboard-write; fullscreen';
  frame.src = frameUrl({ author, webgl });
  let ready = false, dirty = false;
  let queued: File | null = file || null;

  const send = async (f: File) => {
    const buf = await f.arrayBuffer();
    frame.contentWindow!.postMessage({ type: `${PREFIX}open`, version: '1', name: f.name, bytes: buf }, location.origin, [buf]);
  };

  const onMessage = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || typeof d.type !== 'string' || !d.type.startsWith(PREFIX)) return;
    const kind = d.type.slice(PREFIX.length);
    if (kind === 'ready') {
      ready = true;
      fitInterface(frame);
      onReady?.();
      if (queued) { send(queued); queued = null; }
    } else if (kind === 'save') {
      const name = String(d.name || 'Document.docx');
      const bytes = d.bytes instanceof ArrayBuffer ? d.bytes : d.bytes?.buffer;
      if (bytes) onSave?.({ name, blob: new Blob([bytes], { type: mimeFor(name) }), saveAs: !!d.saveAs });
      if (d.id) frame.contentWindow!.postMessage({ type: `${PREFIX}saved`, id: d.id }, location.origin);
    } else if (kind === 'dirty') {
      dirty = !!d.dirty;
      onDirty?.(dirty);
    } else if (kind === 'failed') {
      onFailed?.(String(d.error || 'The editor could not start.'));
    }
  };
  window.addEventListener('message', onMessage);
  holder.append(frame);

  return {
    frame,
    open(f: File) { if (ready) send(f); else queued = f; },
    command(id: string, params: Record<string, unknown> = {}) {
      const api = (frame.contentWindow as any)?.wordcraft;
      if (!api) return Promise.reject(new Error('The editor is not running yet.'));
      return api.execute(id, params);
    },
    dirty: () => dirty,
    destroy() { window.removeEventListener('message', onMessage); frame.remove(); },
  };
}

// WordCraft sizes its ribbon for a desktop window. On a phone it already folds the ribbon
// groups into menus; drawing it smaller as well leaves more of the page in view.
// It keeps the size in its own preferences, so put it back to automatic on a wide screen,
// but only when Sheaf was the one that changed it.
const SIZED = 'sheaf-wordcraft-sized';
function fitInterface(frame: HTMLIFrameElement) {
  const api = (frame.contentWindow as any)?.wordcraft;
  if (!api) return;
  let sized = false;
  try { sized = localStorage.getItem(SIZED) === '1'; } catch { /* private mode */ }
  const narrow = Math.min(innerWidth, screen.width || innerWidth) < 700;
  const remember = (v: boolean) => { try { if (v) localStorage.setItem(SIZED, '1'); else localStorage.removeItem(SIZED); } catch { /* private mode */ } };
  if (narrow) {
    api.execute('ui.interfaceSize', { percent: Math.round(devicePixelRatio * 60) }).then(() => remember(true), () => {});
  } else if (sized) {
    api.execute('ui.interfaceSize', { value: 'auto' }).then(() => remember(false), () => {});
  }
}

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf', pdf: 'application/pdf', png: 'image/png',
  html: 'text/html', md: 'text/markdown', txt: 'text/plain', tex: 'application/x-tex',
};
export const mimeFor = (name: string) => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

/**
 * Converts one document with a hidden editor: opens it, runs Save As (or Export as PDF) and
 * hands back what the editor saved. `format` is an extension: pdf, docx, odt, rtf, html, md, txt.
 */
export function convertDocument(file: File, format: string, { timeout = 120000, webgl }: { timeout?: number; webgl?: boolean } = {}): Promise<{ name: string; blob: Blob }> {
  return new Promise((resolve, reject) => {
    const holder = document.createElement('div');
    // Off screen but laid out: a display:none canvas has no size and egui won't draw into it.
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;pointer-events:none;';
    document.body.append(holder);
    const stem = file.name.replace(/\.[^.]+$/, '') || 'document';
    const target = `${stem}.${format}`;
    let ed: Editor | null = null, finished = false;
    const finish = (err: Error | null, out?: { name: string; blob: Blob }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ed?.destroy(); holder.remove();
      if (err) reject(err); else resolve(out!);
    };
    const timer = setTimeout(() => finish(new Error(`${file.name} took too long to convert.`)), timeout);
    const run = async () => {
      // The editor takes the file on its next frame. Its document changes from the blank
      // one it starts with, so wait for that (an empty file never changes; 5 s covers it).
      const api = () => (ed!.frame.contentWindow as any).wordcraft;
      const snap = async () => { try { return JSON.stringify(await api().docInspect({})); } catch { return ''; } };
      const before = await snap();
      ed!.open(file);
      for (let i = 0; i < 50 && !finished; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const now = await snap();
        if (now && now !== before) break;
      }
      try {
        if (format === 'pdf') await ed!.command('file.exportPdf', { path: target });
        else await ed!.command('file.saveAs', { path: target });
      } catch (e: any) { finish(new Error(`${file.name} could not be converted: ${e?.message || e}`)); }
    };
    ed = mountEditor(holder, {
      webgl,
      onReady: () => { run(); },
      onSave: (out) => { if (out.name.toLowerCase().endsWith(`.${format}`)) finish(null, { name: target, blob: out.blob }); },
      onFailed: (msg) => finish(new Error(msg)),
    });
  });
}
