import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDownAZ, ArrowLeft, CircleAlert, FileIcon, Plus, TriangleAlert, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CameraPanel from '../components/CameraPanel';
import Dropzone, { acceptAttr, sortFiles } from '../components/Dropzone';
import OptionsForm from '../components/OptionsForm';
import PdfThumb from '../components/PdfThumb';
import ResultView from '../components/ResultView';
import { Result, runTool } from '../lib/api';
import { bytes, extOf, plural, uid } from '../lib/format';
import { takeFiles, useStore } from '../lib/store';
import { Options, ToolDef, toolById } from '../tools';

const PagesWorkspace = lazy(() => import('../workspaces/PagesWorkspace'));
const EditorWorkspace = lazy(() => import('../workspaces/EditorWorkspace'));
const CropWorkspace = lazy(() => import('../workspaces/CropWorkspace'));
const CompareWorkspace = lazy(() => import('../workspaces/CompareWorkspace'));

export interface Item {
  id: string;
  file: File;
}

export type Submit =
  | { kind: 'server'; tool: string; files: File[]; options: Options; extra?: Record<string, File> }
  | { kind: 'local'; work: () => Promise<{ blob: Blob; name: string }>; inputBytes: number };

export interface WorkspaceProps {
  tool: ToolDef;
  items: Item[];
  setItems: (next: Item[] | ((prev: Item[]) => Item[])) => void;
  pickMore: () => void;
  submit: (s: Submit) => void;
  reset: () => void;
  error: string;
}

type Stage = 'setup' | 'working' | 'done';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];

function FileCard({ item, onRemove, sortable }: { item: Item; onRemove: () => void; sortable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !sortable,
  });
  const [pages, setPages] = useState<number | null>(null);
  const ext = extOf(item.file.name);
  const url = useMemo(() => (IMAGE_EXT.includes(ext) ? URL.createObjectURL(item.file) : ''), [item.file, ext]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  return (
    <div
      ref={setNodeRef}
      className={`file-card${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${item.file.name}${sortable ? '. Press space to pick up and move.' : ''}`}
    >
      <button
        className="icon-btn icon-btn-sm file-card-remove"
        aria-label={`Remove ${item.file.name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRemove}
      >
        <X size={16} strokeWidth={2.4} />
      </button>
      <div className="file-card-preview">
        {ext === 'pdf' ? (
          <PdfThumb file={item.file} width={132} onInfo={setPages} />
        ) : url ? (
          <img src={url} alt="" draggable={false} />
        ) : (
          <span className="file-card-icon">
            <FileIcon size={36} strokeWidth={1.6} />
            <b>{ext.toUpperCase()}</b>
          </span>
        )}
      </div>
      <p className="file-card-name" title={item.file.name}>
        {item.file.name}
      </p>
      <p className="file-card-meta mono">
        {bytes(item.file.size)}
        {pages ? ` · ${plural(pages, 'page')}` : ''}
      </p>
    </div>
  );
}

export default function ToolPage() {
  const { toolId } = useParams();
  const tool = toolById(toolId);
  if (!tool) {
    return (
      <main id="main" className="container empty">
        <h1>There&rsquo;s no tool at this address</h1>
        <Link to="/" className="btn btn-primary">
          See all tools
        </Link>
      </main>
    );
  }
  return <ToolRunner key={tool.id} tool={tool} />;
}

function ToolRunner({ tool }: { tool: ToolDef }) {
  const { health, toast } = useStore();
  const [items, setItems] = useState<Item[]>(() => (takeFiles(tool.id) ?? []).map((file) => ({ id: uid(), file })));
  const [options, setOptions] = useState<Options>(() => ({ ...tool.defaults }));
  const [stage, setStage] = useState<Stage>('setup');
  const [progress, setProgress] = useState<number | null>(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const cancel = useRef<() => void>();

  useEffect(() => {
    document.title = `${tool.name} · Sheaf`;
    return () => {
      document.title = 'Sheaf · PDF tools on your own machine';
      cancel.current?.();
    };
  }, [tool]);

  const addFiles = useCallback(
    (files: File[]) => {
      setError('');
      setItems((prev) => {
        const next = [...(tool.multiple ? prev : []), ...files.map((file) => ({ id: uid(), file }))];
        if (tool.maxFiles && next.length > tool.maxFiles) {
          toast(`This tool takes ${tool.maxFiles} files, so the extra ones were left out.`);
          return next.slice(0, tool.maxFiles);
        }
        return next;
      });
    },
    [tool, toast],
  );

  const submit = useCallback(
    async (s: Submit) => {
      setError('');
      setProgress(s.kind === 'server' ? 0 : null);
      setStage('working');
      try {
        if (s.kind === 'server') {
          const handle = runTool(s.tool, s.files, s.options, setProgress, s.extra);
          cancel.current = handle.cancel;
          setResult(await handle.promise);
        } else {
          const out = await s.work();
          setResult({ blob: out.blob, name: out.name, count: 1, inputBytes: s.inputBytes });
        }
        setStage('done');
      } catch (err: any) {
        setStage('setup');
        if (err?.name !== 'AbortError') setError(err?.message || 'Something went wrong. Try again.');
      } finally {
        cancel.current = undefined;
      }
    },
    [],
  );

  const reset = () => {
    setItems([]);
    setResult(null);
    setError('');
    setStage('setup');
    setOptions({ ...tool.defaults });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === e.active.id);
      const to = prev.findIndex((i) => i.id === e.over!.id);
      return arrayMove(prev, from, to);
    });
  };

  const missing = health ? (tool.needs ?? []).filter((n) => !health[n]) : [];
  const files = items.map((i) => i.file);
  const hasFiles = items.length > 0;
  const showSetup = hasFiles || (tool.filesOptional && stage === 'setup');
  const problem = useMemo(() => {
    if (!tool.filesOptional && items.length < (tool.minFiles ?? 1)) {
      return tool.minFiles === 2 ? `Add at least two ${tool.noun}s.` : `Add a ${tool.noun}.`;
    }
    return tool.check?.(options, items.length) ?? null;
  }, [tool, options, items.length]);

  const run = () => {
    if (problem) return setError(problem);
    const { image, confirm: _confirm, ...rest } = options;
    void submit({
      kind: 'server',
      tool: tool.id,
      files,
      options: rest,
      extra: image instanceof File ? { image } : undefined,
    });
  };

  const hiddenPicker = (
    <input
      ref={picker}
      type="file"
      className="sr-only"
      tabIndex={-1}
      accept={acceptAttr(tool)}
      multiple={tool.multiple}
      onChange={(e) => {
        const { ok, bad } = sortFiles(tool, Array.from(e.target.files ?? []));
        if (bad.length) toast(`${bad[0].name} isn’t a ${tool.noun}, so it was skipped.`, 'error');
        if (ok.length) addFiles(ok);
        e.target.value = '';
      }}
    />
  );

  const Workspace =
    tool.workspace === 'pages'
      ? PagesWorkspace
      : tool.workspace === 'editor'
        ? EditorWorkspace
        : tool.workspace === 'crop'
          ? CropWorkspace
          : tool.workspace === 'compare'
            ? CompareWorkspace
            : null;
  const inWorkspace = !!Workspace && stage === 'setup' && items.length >= (tool.minFiles ?? 1);

  return (
    <main id="main" data-category={tool.category} className={`tool-page${inWorkspace ? ' tool-page-wide' : ''}`}>
      {hiddenPicker}
      {!inWorkspace && (
        <div className="container tool-head">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} strokeWidth={2.4} />
            All tools
          </Link>
          <h1>{tool.name}</h1>
          <p>{tool.blurb}</p>
        </div>
      )}

      {missing.length > 0 && stage === 'setup' && (
        <div className="container">
          <div className="notice notice-warning" role="alert">
            <TriangleAlert size={20} strokeWidth={2} />
            <span>
              This tool needs {missing.join(' and ')} on the machine running Sheaf, and it isn&rsquo;t there. The Docker
              image has everything; see the README if you run it another way.
            </span>
          </div>
        </div>
      )}

      {stage === 'working' && (
        <div className="container">
          <div className="working" role="status" aria-live="polite">
            <span className="tile tile-lg working-tile">
              <tool.icon size={40} strokeWidth={2} />
            </span>
            <h2>
              {progress !== null && progress < 1 ? 'Sending your files' : tool.working}
              <span className="dots" aria-hidden="true" />
            </h2>
            <div className={`progress${progress === null ? ' is-indeterminate' : ''}`}>
              <div className="progress-fill" style={progress === null ? undefined : { transform: `scaleX(${progress})` }} />
            </div>
            <p className="mono working-pct">
              {progress !== null ? `${Math.round(progress * 100)}%` : 'Working on this machine'}
            </p>
            {cancel.current && (
              <button className="btn btn-ghost" onClick={() => cancel.current?.()}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {stage === 'done' && result && (
        <div className="container">
          <ResultView tool={tool} result={result} onAgain={reset} />
        </div>
      )}

      {stage === 'setup' && !inWorkspace && !showSetup && (
        <div className="container">
          <Dropzone tool={tool} onFiles={addFiles} maxMb={health?.maxUploadMb}>
            {tool.camera && <CameraPanel onShots={addFiles} />}
          </Dropzone>
        </div>
      )}

      {stage === 'setup' && Workspace && inWorkspace && (
        <Suspense fallback={<div className="container loading-block" aria-busy="true" />}>
          <Workspace
            tool={tool}
            items={items}
            setItems={setItems}
            pickMore={() => picker.current?.click()}
            submit={submit}
            reset={reset}
            error={error}
          />
        </Suspense>
      )}

      {stage === 'setup' && !inWorkspace && showSetup && (
        <div className="container setup">
          <section className="setup-files" aria-label="Your files">
            {hasFiles ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
                  <div className="file-grid">
                    {items.map((item) => (
                      <FileCard
                        key={item.id}
                        item={item}
                        sortable={tool.multiple && items.length > 1}
                        onRemove={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                      />
                    ))}
                    {(tool.multiple || !hasFiles) && (!tool.maxFiles || items.length < tool.maxFiles) && (
                      <button className="file-add" onClick={() => picker.current?.click()}>
                        <Plus size={28} strokeWidth={2.2} />
                        Add more
                      </button>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <button className="file-add file-add-wide" onClick={() => picker.current?.click()}>
                <Plus size={28} strokeWidth={2.2} />
                Add {tool.noun}s instead
              </button>
            )}
            {tool.camera && <CameraPanel onShots={addFiles} compact />}
            {tool.multiple && items.length > 1 && (
              <div className="setup-tools">
                <span className="setup-hint">Drag to change the order.</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setItems((prev) =>
                      [...prev].sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })),
                    )
                  }
                >
                  <ArrowDownAZ size={18} strokeWidth={2} />
                  Sort by name
                </button>
              </div>
            )}
          </section>

          <aside className="panel">
            <h2 className="panel-title">
              <span className="tile tile-sm">
                <tool.icon size={18} strokeWidth={2.2} />
              </span>
              {tool.name}
            </h2>
            {tool.fields?.length ? (
              <OptionsForm fields={tool.fields} values={options} onChange={(patch) => { setError(''); setOptions((o) => ({ ...o, ...patch })); }} />
            ) : (
              <p className="panel-note">
                {tool.id === 'merge'
                  ? 'Files are joined top to bottom in the order shown.'
                  : 'No settings needed. Hit the button when you’re ready.'}
              </p>
            )}
            <div className="panel-foot">
              {error && (
                <p className="form-error" role="alert">
                  <CircleAlert size={18} strokeWidth={2.2} />
                  {error}
                </p>
              )}
              <button className="btn btn-primary btn-lg btn-block" onClick={run} disabled={missing.length > 0}>
                {tool.action}
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
