import { ChevronLeft, ChevronRight, Maximize } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { plural } from '../lib/format';
import { openPdf, PDFDocumentProxy, renderPage } from '../lib/pdf';
import { cropPdf, CropRect } from '../lib/pdfEdit';
import type { WorkspaceProps } from '../pages/ToolPage';
import Shell from './Shell';

const FULL: CropRect = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
const MIN = 0.05;

export default function CropWorkspace({ tool, items, submit, reset, error }: WorkspaceProps) {
  const file = items[0].file;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [rect, setRect] = useState<CropRect>(FULL);
  const [scope, setScope] = useState<'all' | 'one'>('all');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loadError, setLoadError] = useState('');
  const [points, setPoints] = useState({ w: 0, h: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; x: number; y: number; orig: CropRect } | null>(null);

  useEffect(() => {
    let alive = true;
    openPdf(file).then(
      (d) => alive && setDoc(d),
      (err) => alive && setLoadError(err.message),
    );
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    if (!doc || !canvas.current || !stage.current) return;
    let alive = true;
    (async () => {
      const p = await doc.getPage(page);
      const v = p.getViewport({ scale: 1 });
      const room = stage.current!.getBoundingClientRect();
      const width = Math.max(200, Math.min(room.width - 48, ((room.height - 48) * v.width) / v.height, 900));
      if (!alive) return;
      const s = await renderPage(p, canvas.current!, width);
      if (alive) {
        setSize(s);
        setPoints({ w: v.width, h: v.height });
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc, page]);

  const start = (e: React.PointerEvent, mode: string) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, orig: rect };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !size.width) return;
    const dx = (e.clientX - d.x) / size.width;
    const dy = (e.clientY - d.y) / size.height;
    let { x, y, w, h } = d.orig;
    if (d.mode === 'move') {
      x = Math.min(Math.max(0, x + dx), 1 - w);
      y = Math.min(Math.max(0, y + dy), 1 - h);
    } else {
      if (d.mode.includes('w')) {
        const nx = Math.min(Math.max(0, x + dx), x + w - MIN);
        w += x - nx;
        x = nx;
      }
      if (d.mode.includes('e')) w = Math.min(Math.max(MIN, w + dx), 1 - x);
      if (d.mode.includes('n')) {
        const ny = Math.min(Math.max(0, y + dy), y + h - MIN);
        h += y - ny;
        y = ny;
      }
      if (d.mode.includes('s')) h = Math.min(Math.max(MIN, h + dy), 1 - y);
    }
    setRect({ x, y, w, h });
  };

  const nudge = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const by = map[e.key];
    if (!by) return;
    e.preventDefault();
    setRect((r) => ({ ...r, x: Math.min(Math.max(0, r.x + by[0]), 1 - r.w), y: Math.min(Math.max(0, r.y + by[1]), 1 - r.h) }));
  };

  const mm = (pts: number) => Math.round((pts / 72) * 25.4);
  const whole = rect.w > 0.995 && rect.h > 0.995;

  return (
    <Shell
      tool={tool}
      title={file.name}
      meta={doc ? plural(doc.numPages, 'page') : undefined}
      onBack={reset}
      error={error || loadError}
      bar={
        doc && doc.numPages > 1 ? (
          <div className="pager">
            <button className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={20} strokeWidth={2.2} />
            </button>
            <span className="mono">
              {page} / {doc.numPages}
            </span>
            <button className="icon-btn" aria-label="Next page" disabled={page >= doc.numPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={20} strokeWidth={2.2} />
            </button>
          </div>
        ) : null
      }
      panel={
        <>
          <h3 className="panel-title">Choose what to keep</h3>
          <p className="panel-note">Drag the frame or its corners. Everything outside it is trimmed away.</p>
          <div className="field">
            <span className="field-label">Apply to</span>
            <div className="choices choices-compact" role="radiogroup">
              <button className="choice" role="radio" aria-checked={scope === 'all'} onClick={() => setScope('all')}>
                <span className="choice-text">
                  <strong>All pages</strong>
                </span>
              </button>
              <button className="choice" role="radio" aria-checked={scope === 'one'} onClick={() => setScope('one')}>
                <span className="choice-text">
                  <strong>Page {page} only</strong>
                </span>
              </button>
            </div>
          </div>
          <p className="picked-count mono">
            {points.w ? `${mm(points.w * rect.w)} × ${mm(points.h * rect.h)} mm` : ''}
          </p>
          <button className="btn btn-secondary btn-sm" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}>
            <Maximize size={16} strokeWidth={2.2} />
            Reset to the full page
          </button>
        </>
      }
      action={
        <button
          className="btn btn-primary btn-lg"
          disabled={!doc || whole}
          onClick={() =>
            submit({ kind: 'local', inputBytes: file.size, work: () => cropPdf(file, rect, scope === 'one' ? page - 1 : null) })
          }
        >
          {tool.action}
        </button>
      }
    >
      <div className="crop-stage" ref={stage}>
        <div className="crop-page" style={size.width ? { width: size.width, height: size.height } : undefined}>
          <canvas ref={canvas} style={size.width ? { width: size.width, height: size.height } : undefined} />
          {size.width > 0 && (
            <div
              className="crop-frame"
              tabIndex={0}
              role="group"
              aria-label="Crop frame. Use the arrow keys to move it."
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
              onPointerDown={(e) => start(e, 'move')}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
              onKeyDown={nudge}
            >
              {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((c) => (
                <span
                  key={c}
                  className={`crop-handle crop-${c}`}
                  onPointerDown={(e) => start(e, c)}
                  onPointerMove={move}
                  onPointerUp={() => (drag.current = null)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
