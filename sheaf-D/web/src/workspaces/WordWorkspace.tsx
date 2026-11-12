import { ArrowLeft, CircleAlert, Download, FileText, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crumbs } from '../App';
import { saveBlob } from '../lib/api';
import { coarsePointer } from '../lib/device';
import { useStore } from '../lib/store';
import { canRunEditor, Editor, editorInstalled, mountEditor } from '../lib/wordcraft';
import { CATEGORIES } from '../tools';
import type { WorkspaceProps } from '../pages/ToolPage';

type State = 'starting' | 'ready' | { problem: string; detail: string };

/**
 * Edit Word: WordCraft fills the canvas and brings its own ribbon. This page sends it the
 * document, downloads whatever it saves, and asks before throwing away unsaved changes.
 */
export default function WordWorkspace({ tool, items, reset }: WorkspaceProps) {
  const holder = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const navigate = useNavigate();
  const { toast } = useStore();
  const [state, setState] = useState<State>('starting');
  const [dirty, setDirty] = useState(false);
  const file = items[0]?.file ?? null;
  const [name, setName] = useState(file?.name ?? 'Document.docx');
  const family = CATEGORIES.find((c) => c.id === tool.category)!;

  useEffect(() => {
    let gone = false;
    (async () => {
      if (!canRunEditor()) {
        return setState({
          problem: 'This browser cannot run the editor',
          detail: 'The Word editor draws with WebGPU or WebGL2, and this browser has neither turned on. Recent Chrome, Edge, Firefox and Safari all have them.',
        });
      }
      if (!(await editorInstalled())) {
        return setState({
          problem: 'The Word editor is not installed',
          detail: 'This build of Sheaf-D has no WordCraft files in web/public/wordcraft. Rebuild the image, or run npm run wordcraft in sheaf-D/web.',
        });
      }
      if (gone || !holder.current) return;
      editor.current = mountEditor(holder.current, {
        file,
        // Phones often advertise WebGPU and then fail to start it. WebGL2 works there.
        webgl: coarsePointer(),
        onReady: () => setState('ready'),
        onDirty: setDirty,
        onFailed: (error) => setState({ problem: 'The editor could not start', detail: `${error}. Try another browser, or update this one.` }),
        onSave: (out) => {
          // A save in a document format names the file being edited: after Save As, or after a
          // file was opened from the editor's own File menu. PDFs and other exports are copies.
          if (out.saveAs || /\.(docx|docm|dotx|dotm|odt|ott|rtf)$/i.test(out.name)) setName(out.name);
          saveBlob(out.blob, out.name);
          toast(`${out.name} downloaded`, 'success');
        },
      });
    })();
    return () => {
      gone = true;
      editor.current?.destroy();
      editor.current = null;
    };
  }, [file, toast]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const run = async (id: string) => {
    try {
      await editor.current?.command(id);
    } catch (err: any) {
      toast(err?.message || 'That did not work.', 'error');
    }
  };
  const leave = (to?: string) => {
    if (dirty && !confirm('Your document has changes you have not saved. Leave anyway?')) return;
    if (to) navigate(to);
    else reset();
  };
  const ready = state === 'ready';

  return (
    <div className="content word-content">
      <Crumbs trail={[{ label: 'All tools', to: '/' }, { label: family.name }, { label: tool.name }]} />
      <div className="canvas word-canvas">
        <div ref={holder} className="word-host" />
        {state === 'starting' && (
          <div className="word-wait" role="status">
            <span className="spinner" aria-hidden="true" />
            <p>Starting the editor…</p>
          </div>
        )}
        {typeof state === 'object' && (
          <div className="word-fail">
            <span className="tile tile-lg">
              <FileText size={30} strokeWidth={1.8} />
            </span>
            <h2>{state.problem}</h2>
            <p>{state.detail}</p>
          </div>
        )}
      </div>
      <div className="action-bar">
        <button className="btn btn-ghost" onClick={() => leave(items.length ? undefined : '/')}>
          <ArrowLeft size={18} strokeWidth={2} />
          <span className="hide-narrow">{items.length ? 'Start over' : 'All tools'}</span>
        </button>
        <p className="action-summary">
          <span className="action-file" title={name}>{name}</span>
          {dirty && <span className="word-dirty">Unsaved</span>}
          {!dirty && ready && <span className="action-hint">Save sends the file to your downloads.</span>}
        </p>
        {typeof state === 'object' ? (
          <p className="note note-error" role="alert">
            <CircleAlert size={18} strokeWidth={2} />
            Not available here
          </p>
        ) : (
          <>
            <button className="btn btn-secondary" disabled={!ready} onClick={() => run('file.exportPdf')}>
              <Download size={18} strokeWidth={2.2} />
              <span className="hide-narrow">PDF</span>
            </button>
            <button className="btn btn-primary btn-lg" disabled={!ready} onClick={() => run('file.save')}>
              <Save size={18} strokeWidth={2.2} />
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
