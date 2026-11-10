import { closestCenter, DndContext, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Copy, FilePlus2, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import PdfThumb from '../components/PdfThumb';
import { plural, toRanges, uid } from '../lib/format';
import { openPdf } from '../lib/pdf';
import { useStore } from '../lib/store';
import type { WorkspaceProps } from '../pages/ToolPage';
import Shell from './Shell';

interface PageRef {
  id: string;
  item: string; // id of the file it came from, '' for a blank page
  page: number;
  rotate: number;
}

function parsePicked(text: string, total: number): number[] | null {
  const out: number[] = [];
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+|end))?$/i.exec(part);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = m[2] ? (m[2].toLowerCase() === 'end' ? total : parseInt(m[2], 10)) : a;
    if (a < 1 || b > total || a > b) return null;
    for (let p = a; p <= b; p++) out.push(p);
  }
  return out;
}

interface CellProps {
  p: PageRef;
  index: number;
  file: File | undefined;
  width: number;
  mode: 'organize' | 'pick';
  picked: boolean;
  danger: boolean;
  onPick: (shift: boolean) => void;
  onRotate: (by: number) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function PageCell({ p, index, file, width, mode, picked, danger, onPick, onRotate, onDelete, onDuplicate }: CellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
    disabled: mode !== 'organize',
  });
  const label = file ? `Page ${p.page} of ${file.name}` : 'Blank page';
  return (
    <div
      ref={setNodeRef}
      className={`page-cell${isDragging ? ' is-dragging' : ''}${picked ? ' is-picked' : ''}${danger ? ' is-danger' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition, width: width + 20 }}
    >
      <div
        className="page-face"
        {...(mode === 'organize' ? { ...attributes, ...listeners } : {})}
        {...(mode === 'pick'
          ? {
              role: 'checkbox',
              'aria-checked': picked,
              tabIndex: 0,
              onClick: (e: React.MouseEvent) => onPick(e.shiftKey),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  onPick(e.shiftKey);
                }
              },
            }
          : {})}
        aria-label={label}
      >
        {file ? (
          <PdfThumb file={file} page={p.page} width={width} rotation={p.rotate} />
        ) : (
          <div className="thumb thumb-blank" style={{ width, height: width * 1.414 }}>
            Blank
          </div>
        )}
        {picked && (
          <span className="page-check">
            {danger ? <Trash2 size={16} strokeWidth={2.4} /> : <Check size={16} strokeWidth={3} />}
          </span>
        )}
      </div>
      {mode === 'organize' && (
        <div className="page-tools">
          <button className="icon-btn icon-btn-sm" aria-label="Rotate right" title="Rotate right" onClick={() => onRotate(90)}>
            <RotateCw size={15} strokeWidth={2.2} />
          </button>
          <button className="icon-btn icon-btn-sm" aria-label="Duplicate page" title="Duplicate" onClick={onDuplicate}>
            <Copy size={15} strokeWidth={2.2} />
          </button>
          <button className="icon-btn icon-btn-sm" aria-label="Delete page" title="Delete" onClick={onDelete}>
            <Trash2 size={15} strokeWidth={2.2} />
          </button>
        </div>
      )}
      <span className="page-num mono">{index + 1}</span>
    </div>
  );
}

export default function PagesWorkspace({ tool, items, pickMore, submit, reset, error }: WorkspaceProps) {
  const { toast } = useStore();
  const mode = tool.id === 'organize' ? 'organize' : 'pick';
  const [pages, setPages] = useState<PageRef[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rangeText, setRangeText] = useState('');
  const [separate, setSeparate] = useState(false);
  const [zoom, setZoom] = useState(150);
  const [loadError, setLoadError] = useState('');
  const loaded = useRef(new Set<string>());
  const lastPick = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const item of items) {
        if (loaded.current.has(item.id)) continue;
        loaded.current.add(item.id);
        try {
          const doc = await openPdf(item.file);
          if (!alive) return;
          setPages((prev) => [
            ...prev,
            ...Array.from({ length: doc.numPages }, (_, i) => ({ id: uid(), item: item.id, page: i + 1, rotate: 0 })),
          ]);
        } catch (err: any) {
          if (alive) setLoadError(err.message);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [items]);

  const fileOf = useMemo(() => new Map(items.map((i) => [i.id, i.file])), [items]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setPages((prev) => arrayMove(prev, prev.findIndex((p) => p.id === e.active.id), prev.findIndex((p) => p.id === e.over!.id)));
  };

  const setPickedPages = (next: Set<string>) => {
    setPicked(next);
    setRangeText(toRanges(pages.filter((p) => next.has(p.id)).map((p) => p.page)));
  };

  const pick = (index: number, shift: boolean) => {
    const next = new Set(picked);
    if (shift && lastPick.current !== null) {
      const [a, b] = [Math.min(lastPick.current, index), Math.max(lastPick.current, index)];
      for (let i = a; i <= b; i++) next.add(pages[i].id);
    } else if (next.has(pages[index].id)) next.delete(pages[index].id);
    else next.add(pages[index].id);
    lastPick.current = index;
    setPickedPages(next);
  };

  const remove = (id: string) => {
    const before = pages;
    setPages((prev) => prev.filter((p) => p.id !== id));
    toast('Page removed.', 'info', { label: 'Undo', run: () => setPages(before) });
  };

  const pickedCount = picked.size;
  const total = pages.length;
  const danger = tool.id === 'remove-pages';

  let problem = '';
  if (mode === 'pick' && !pickedCount) problem = danger ? 'Click the pages you want to remove.' : 'Click the pages you want to keep.';
  if (danger && pickedCount === total && total > 0) problem = 'Leave at least one page in the document.';
  if (mode === 'organize' && !total) problem = 'There are no pages left to save.';

  const run = () => {
    const files = items.map((i) => i.file);
    if (mode === 'organize') {
      submit({
        kind: 'server',
        tool: 'organize',
        files,
        options: {
          pages: pages.map((p) =>
            p.item ? { file: items.findIndex((i) => i.id === p.item), page: p.page, rotate: p.rotate } : { blank: true },
          ),
        },
      });
    } else {
      submit({
        kind: 'server',
        tool: tool.id,
        files,
        options: { pages: toRanges(pages.filter((p) => picked.has(p.id)).map((p) => p.page)), separate },
      });
    }
  };

  const panel =
    mode === 'organize' ? (
      <>
        <h2 className="panel-title">Arrange your pages</h2>
        <p className="panel-note">Drag pages to reorder them. Hover a page to rotate, copy or delete it.</p>
        <div className="panel-actions">
          <button className="btn btn-accent" onClick={pickMore}>
            <Plus size={18} strokeWidth={2.4} />
            Add another PDF
          </button>
          <button className="btn btn-secondary" onClick={() => setPages((prev) => [...prev, { id: uid(), item: '', page: 0, rotate: 0 }])}>
            <FilePlus2 size={18} strokeWidth={2.2} />
            Add a blank page
          </button>
          <div className="btn-pair">
            <button className="btn btn-secondary" onClick={() => setPages((prev) => prev.map((p) => ({ ...p, rotate: (p.rotate + 270) % 360 })))}>
              <RotateCcw size={18} strokeWidth={2.2} />
              All left
            </button>
            <button className="btn btn-secondary" onClick={() => setPages((prev) => prev.map((p) => ({ ...p, rotate: (p.rotate + 90) % 360 })))}>
              <RotateCw size={18} strokeWidth={2.2} />
              All right
            </button>
          </div>
        </div>
      </>
    ) : (
      <>
        <h2 className="panel-title">{danger ? 'Pages to remove' : 'Pages to extract'}</h2>
        <p className="panel-note">
          Click pages to {danger ? 'mark them for removal' : 'pick them'}. Shift-click selects everything in between.
        </p>
        <div className="field">
          <label className="field-label" htmlFor="page-range">
            Or type them
          </label>
          <input
            id="page-range"
            className="input"
            placeholder="1-3, 5, 8-end"
            value={rangeText}
            spellCheck={false}
            onChange={(e) => {
              setRangeText(e.target.value);
              const nums = parsePicked(e.target.value, total);
              if (nums) setPicked(new Set(pages.filter((p) => nums.includes(p.page)).map((p) => p.id)));
            }}
          />
        </div>
        <p className="picked-count mono" aria-live="polite">
          {pickedCount ? `${plural(pickedCount, 'page')} of ${total} selected` : `${plural(total, 'page')}, none selected`}
        </p>
        <div className="btn-pair">
          <button className="btn btn-secondary btn-sm" onClick={() => setPickedPages(new Set(pages.map((p) => p.id)))}>
            Select all
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setPickedPages(new Set())}>
            Clear
          </button>
        </div>
        {!danger && (
          <label className="toggle-row">
            <input type="checkbox" className="toggle" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
            <span>Save each page as its own PDF</span>
          </label>
        )}
      </>
    );

  return (
    <Shell
      tool={tool}
      title={items.length === 1 ? items[0].file.name : plural(items.length, 'file')}
      meta={plural(total, 'page')}
      onBack={reset}
      error={error || loadError}
      bar={
        <label className="zoom">
          <span className="sr-only">Thumbnail size</span>
          <input type="range" min={100} max={280} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
      }
      panel={panel}
      action={
        <>
          {problem && <p className="panel-note">{problem}</p>}
          <button className="btn btn-primary btn-lg btn-block" onClick={run} disabled={!!problem}>
            {tool.action}
          </button>
        </>
      }
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="page-grid">
            {pages.map((p, i) => (
              <PageCell
                key={p.id}
                p={p}
                index={i}
                file={fileOf.get(p.item)}
                width={zoom}
                mode={mode}
                picked={picked.has(p.id)}
                danger={danger}
                onPick={(shift) => pick(i, shift)}
                onRotate={(by) => setPages((prev) => prev.map((x) => (x.id === p.id ? { ...x, rotate: (x.rotate + by) % 360 } : x)))}
                onDelete={() => remove(p.id)}
                onDuplicate={() =>
                  setPages((prev) => {
                    const at = prev.findIndex((x) => x.id === p.id);
                    return [...prev.slice(0, at + 1), { ...p, id: uid() }, ...prev.slice(at + 1)];
                  })
                }
              />
            ))}
            {!total && !loadError && <div className="loading-block" aria-busy="true" />}
          </div>
        </SortableContext>
      </DndContext>
    </Shell>
  );
}
