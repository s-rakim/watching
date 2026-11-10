import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDownAZ, CircleAlert, FileIcon, GripVertical, TriangleAlert, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Crumbs } from '../App';
import CameraPanel from '../components/CameraPanel';
import Dropzone, { acceptAttr, sortFiles } from '../components/Dropzone';
import OptionsForm from '../components/OptionsForm';
import PdfThumb from '../components/PdfThumb';
import ResultView from '../components/ResultView';
import { Result, runTool } from '../lib/api';
import { bytes, extOf, plural, uid } from '../lib/format';
import { takeFiles, useStore } from '../lib/store';
import { CATEGORIES, Options, ToolDef, toolById } from '../tools';

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

function FileRow({ item, onRemove, sortable }: { item: Item; onRemove: () => void; sortable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !sortable,
  });
  const [pages, setPages] = useState<number | null>(null);
  const ext = extOf(item.file.name);
  const url = useMemo(() => (IMAGE_EXT.includes(ext) ? URL.createObjectURL(item.file) : ''), [item.file, ext]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  return (
    <li
      ref={setNodeRef}
      className={`file-row${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {sortable ? (
        <button className="file-grip" aria-label={`Move ${item.file.name}`} {...attributes} {...listeners}>
          <GripVertical size={18} strokeWidth={2} />
        </button>
      ) : (
        <span className="file-grip" />
      )}
      <span className="file-thumb">
        {ext === 'pdf' ? (
          <PdfThumb file={item.file} width={30} onInfo={setPages} />
        ) : url ? (
          <img src={url} alt="" draggable={false} />
        ) : (
          <FileIcon size={22} strokeWidth={1.6} />
        )}
      </span>
      <span className="file-name">{item.file.name}</span>
      <span className="file-num mono">{pages ?? (ext === 'pdf' ? '' : ext.toUpperCase())}</span>
      <span className="file-num mono">{bytes(item.file.size)}</span>
      <button className="icon-btn" aria-label={`Remove ${item.file.name}`} title="Remove" onClick={onRemove}>
        <X size={18} strokeWidth={2} />
      </button>
    </li>
  );
}

export default function ToolPage() {
  const { toolId } = useParams();
  const tool = toolById(toolId);
  if (!tool) {
    return (
      <div className="content">
        <Crumbs trail={[{ label: 'All tools', to: '/' }, { label: 'Not found' }]} />
        <div className="content-scroll">
          <div className="empty">
            <h2>There&rsquo;s no tool at this address</h2>
            <Link to="/" className="btn btn-primary">
              See all tools
            </Link>
          </div>
        </div>
      </div>
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
  const inWorkspace = !!Workspace && items.length >= (tool.minFiles ?? 1);

  const family = CATEGORIES.find((c) => c.id === tool.category)!;
  const trail = [{ label: 'All tools', to: '/' }, { label: family.name }, { label: tool.name }];
  const setupOpen = stage === 'setup' && !inWorkspace && showSetup;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  if (stage === 'setup' && Workspace && inWorkspace) {
    return (
      <div className="tool" data-category={tool.category}>
        {hiddenPicker}
        <Suspense
          fallback={
            <div className="content">
              <Crumbs trail={trail} />
              <div className="content-scroll">
                <div className="loading-block" aria-busy="true" />
              </div>
            </div>
          }
        >
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
      </div>
    );
  }

  return (
    <div className="tool" data-category={tool.category}>
      {hiddenPicker}
      <div className="content">
        <Crumbs trail={trail} />
        <div className="content-scroll">
          <div className="page page-tool">
            {!setupOpen && stage === 'setup' && (
              <div className="tool-head">
                <span className="tile tile-lg">
                  <tool.icon size={30} strokeWidth={1.8} />
                </span>
                <div>
                  <h1>{tool.name}</h1>
                  <p>{tool.blurb}</p>
                </div>
              </div>
            )}

            {missing.length > 0 && stage === 'setup' && (
              <div className="note note-warning" role="alert">
                <TriangleAlert size={20} strokeWidth={2} />
                <span>
                  This tool needs {missing.join(' and ')} on the machine running Sheaf, and it isn&rsquo;t there. The
                  Docker image has everything; see the README if you run it another way.
                </span>
              </div>
            )}

            {stage === 'working' && (
              <div className="working" role="status" aria-live="polite">
                <span className="tile tile-xl working-tile">
                  <tool.icon size={36} strokeWidth={1.8} />
                </span>
                <h2>
                  {progress !== null && progress < 1 ? 'Sending your files' : tool.working}
                  <span className="dots" aria-hidden="true" />
                </h2>
                <div className={`progress${progress === null ? ' is-indeterminate' : ''}`}>
                  <div className="progress-fill" style={progress === null ? undefined : { transform: `scaleX(${progress})` }} />
                </div>
                <p className="mono muted">{progress !== null ? `${Math.round(progress * 100)}%` : 'Working on this machine'}</p>
                {cancel.current && (
                  <button className="btn btn-ghost" onClick={() => cancel.current?.()}>
                    Cancel
                  </button>
                )}
              </div>
            )}

            {stage === 'done' && result && <ResultView tool={tool} result={result} onAgain={reset} />}

            {stage === 'setup' && (
              <Dropzone tool={tool} onFiles={addFiles} maxMb={health?.maxUploadMb} compact={hasFiles}>
                {tool.camera && <CameraPanel onShots={addFiles} compact={hasFiles} />}
              </Dropzone>
            )}

            {setupOpen && hasFiles && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <div className="file-list">
                    <div className="file-row file-head">
                      <span className="file-grip" />
                      <span className="file-thumb" />
                      <span className="file-name">Name</span>
                      <span className="file-num">{tool.accept.includes('pdf') ? 'Pages' : 'Type'}</span>
                      <span className="file-num">Size</span>
                      {tool.multiple && items.length > 1 ? (
                        <button
                          className="icon-btn"
                          aria-label="Sort by name"
                          title="Sort by name"
                          onClick={() =>
                            setItems((prev) =>
                              [...prev].sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })),
                            )
                          }
                        >
                          <ArrowDownAZ size={18} strokeWidth={2} />
                        </button>
                      ) : (
                        <span className="icon-btn" />
                      )}
                    </div>
                    <ul>
                      {items.map((item) => (
                        <FileRow
                          key={item.id}
                          item={item}
                          sortable={tool.multiple && items.length > 1}
                          onRemove={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                        />
                      ))}
                    </ul>
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {setupOpen && (
          <div className="action-bar">
            {error ? (
              <p className="note note-error" role="alert">
                <CircleAlert size={18} strokeWidth={2} />
                {error}
              </p>
            ) : (
              <p className="action-summary">
                {hasFiles ? (
                  <>
                    <span className="mono">{plural(items.length, 'file')}</span>, <span className="mono">{bytes(totalBytes)}</span>
                    {tool.multiple && items.length > 1 ? '. Drag the handles to reorder.' : ''}
                  </>
                ) : (
                  'No files added'
                )}
              </p>
            )}
            <button className="btn btn-primary btn-lg" onClick={run} disabled={missing.length > 0}>
              {tool.action}
            </button>
          </div>
        )}
      </div>

      {setupOpen && (
        <aside className="sidebar" aria-label={`${tool.name} options`}>
          <div className="sidebar-head">
            <span className="tile">
              <tool.icon size={22} strokeWidth={1.8} />
            </span>
            <div>
              <h2>{tool.name}</h2>
              <p>{tool.blurb}</p>
            </div>
          </div>
          <div className="sidebar-body">
            {tool.fields?.length ? (
              <OptionsForm
                fields={tool.fields}
                values={options}
                onChange={(patch) => {
                  setError('');
                  setOptions((o) => ({ ...o, ...patch }));
                }}
              />
            ) : (
              <p className="muted">
                {tool.id === 'merge'
                  ? 'Files are joined top to bottom in the order shown. Drag the handles to change it.'
                  : 'No settings needed. Hit the button when you\u2019re ready.'}
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
