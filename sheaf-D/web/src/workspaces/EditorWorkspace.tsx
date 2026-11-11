import {
  CalendarDays,
  Circle,
  Copy,
  Eraser,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Search,
  Signature,
  Slash,
  Square,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { plural, uid } from '../lib/format';
import { openPdf, PDFDocumentProxy } from '../lib/pdf';
import { applyEdits, FONT_CSS, FontFamily, LINE_HEIGHT, Obj, redactPdf } from '../lib/pdfEdit';
import { useStore } from '../lib/store';
import type { WorkspaceProps } from '../pages/ToolPage';
import Shell from './Shell';
import SignatureDialog, { Stamp } from './SignatureDialog';

type ToolId = 'select' | 'text' | 'draw' | 'highlight' | 'rect' | 'ellipse' | 'line' | 'whiteout' | 'redact' | 'stamp';

interface Style {
  color: string;
  strokeWidth: number;
  size: number;
  font: FontFamily;
  bold: boolean;
  fill: boolean;
  highlight: string;
}

interface PageSize {
  w: number;
  h: number;
}

const TOOLSETS: Record<string, { id: ToolId; label: string; key: string; icon: LucideIcon }[]> = {
  edit: [
    { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
    { id: 'text', label: 'Text', key: 'T', icon: Type },
    { id: 'draw', label: 'Draw', key: 'D', icon: Pencil },
    { id: 'highlight', label: 'Highlight', key: 'H', icon: Highlighter },
    { id: 'rect', label: 'Rectangle', key: 'R', icon: Square },
    { id: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle },
    { id: 'line', label: 'Line', key: 'L', icon: Slash },
    { id: 'whiteout', label: 'White out', key: 'E', icon: Eraser },
  ],
  sign: [
    { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
    { id: 'text', label: 'Text', key: 'T', icon: Type },
  ],
  redact: [
    { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
    { id: 'redact', label: 'Black out an area', key: 'R', icon: SquareDashed },
  ],
};

const COLOURS = ['#1f1a14', '#c9252b', '#0a62a0', '#17733a', '#ff6b3d', '#ffffff'];
const HIGHLIGHTS = ['#ffe14d', '#8fd14f', '#ff9ec3', '#7fd3ff'];
const MIN_BOX = 4;

interface Drag {
  kind: 'create' | 'move' | 'resize' | 'draw';
  id: string;
  page: number;
  startX: number;
  startY: number;
  orig?: Obj;
  corner?: string;
  points?: [number, number][];
  moved: boolean;
}

interface PageProps {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  zoom: number;
  objects: Obj[];
  selected: string | null;
  editing: string | null;
  tool: ToolId;
  onDown: (e: React.PointerEvent, page: number) => void;
  onMove: (e: React.PointerEvent, page: number) => void;
  onUp: (e: React.PointerEvent, page: number) => void;
  onEdit: (id: string) => void;
  onText: (id: string, text: string) => void;
  onBlurText: (id: string) => void;
}

const PageView = memo(function PageView(props: PageProps) {
  const { doc, index, size, zoom, objects, selected, editing, tool } = props;
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(index < 2);

  useEffect(() => {
    const el = holder.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      rootMargin: '600px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let alive = true;
    const timer = setTimeout(async () => {
      const page = await doc.getPage(index + 1);
      if (!alive || !canvas.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: zoom * dpr });
      const off = document.createElement('canvas');
      off.width = Math.round(viewport.width);
      off.height = Math.round(viewport.height);
      task = page.render({ canvasContext: off.getContext('2d')!, viewport });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (!alive || !canvas.current) return;
      canvas.current.width = off.width;
      canvas.current.height = off.height;
      canvas.current.getContext('2d')!.drawImage(off, 0, 0);
    }, 60);
    return () => {
      alive = false;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, index, zoom, visible]);

  return (
    <div className="ed-page-wrap">
      <div
        ref={holder}
        className={`ed-page tool-${tool}`}
        data-page={index}
        style={{ width: size.w * zoom, height: size.h * zoom }}
        onPointerDown={(e) => props.onDown(e, index)}
        onPointerMove={(e) => props.onMove(e, index)}
        onPointerUp={(e) => props.onUp(e, index)}
        onPointerCancel={(e) => props.onUp(e, index)}
      >
        <canvas ref={canvas} style={{ width: size.w * zoom, height: size.h * zoom }} />
        {objects.map((o) => (
          <ObjectView
            key={o.id}
            o={o}
            zoom={zoom}
            selected={selected === o.id}
            editing={editing === o.id}
            onEdit={props.onEdit}
            onText={props.onText}
            onBlurText={props.onBlurText}
          />
        ))}
      </div>
      <span className="page-num mono">{index + 1}</span>
    </div>
  );
});

interface ObjectProps {
  o: Obj;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onEdit: (id: string) => void;
  onText: (id: string, text: string) => void;
  onBlurText: (id: string) => void;
}

function ObjectView({ o, zoom, selected, editing, onEdit, onText, onBlurText }: ObjectProps) {
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (o.type !== 'text' || !textRef.current) return;
    if (textRef.current.innerText !== o.text && !editing) textRef.current.innerText = o.text;
  }, [o, editing]);

  useEffect(() => {
    if (editing && textRef.current) {
      const el = textRef.current;
      el.innerText = (o as any).text ?? '';
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const base: React.CSSProperties = { left: o.x * zoom, top: o.y * zoom };
  const cls = `ed-obj ed-${o.type}${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`;
  const handles =
    selected && !editing && o.type !== 'text'
      ? ['nw', 'ne', 'sw', 'se'].map((c) => <span key={c} className={`ed-handle ed-handle-${c}`} data-handle={c} />)
      : null;

  if (o.type === 'text') {
    return (
      <div className={cls} data-obj={o.id} style={base} onDoubleClick={() => onEdit(o.id)}>
        <div
          ref={textRef}
          className="ed-text-body"
          contentEditable={editing ? ('plaintext-only' as any) : false}
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder="Type here"
          style={{
            fontSize: o.size * zoom,
            lineHeight: LINE_HEIGHT,
            color: o.color,
            fontFamily: FONT_CSS[o.font],
            fontWeight: o.bold ? 700 : 400,
          }}
          onInput={(e) => onText(o.id, (e.target as HTMLDivElement).innerText.replace(/\n$/, ''))}
          onBlur={() => onBlurText(o.id)}
          onPointerDown={(e) => editing && e.stopPropagation()}
        />
      </div>
    );
  }

  const box: React.CSSProperties = { ...base, width: Math.max(o.w, 1) * zoom, height: Math.max(o.h, 1) * zoom };

  if (o.type === 'rect' || o.type === 'ellipse') {
    return (
      <div
        className={cls}
        data-obj={o.id}
        style={{
          ...box,
          border: `${o.strokeWidth * zoom}px solid ${o.stroke}`,
          background: o.fill ?? 'transparent',
          borderRadius: o.type === 'ellipse' ? '50%' : 0,
        }}
      >
        {handles}
      </div>
    );
  }
  if (o.type === 'highlight') {
    return (
      <div className={cls} data-obj={o.id} style={{ ...box, background: o.color }}>
        {handles}
      </div>
    );
  }
  if (o.type === 'whiteout' || o.type === 'redact') {
    return (
      <div className={cls} data-obj={o.id} style={box}>
        {handles}
      </div>
    );
  }
  if (o.type === 'image') {
    return (
      <div className={cls} data-obj={o.id} style={box}>
        <img src={o.src} alt="" draggable={false} />
        {handles}
      </div>
    );
  }
  // line and path share an SVG box
  const w = Math.max(o.w, 1);
  const h = Math.max(o.h, 1);
  return (
    <div className={cls} data-obj={o.id} style={box}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" overflow="visible">
        {o.type === 'line' ? (
          <line
            x1={0}
            y1={o.flip ? h : 0}
            x2={w}
            y2={o.flip ? 0 : h}
            stroke={o.stroke}
            strokeWidth={o.strokeWidth}
            strokeLinecap="round"
          />
        ) : (
          <polyline
            points={(o as Extract<Obj, { type: 'path' }>).points.map(([px, py]) => `${px * w},${py * h}`).join(' ')}
            fill="none"
            stroke={o.stroke}
            strokeWidth={o.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {handles}
    </div>
  );
}

export default function EditorWorkspace({ tool, items, submit, reset, error }: WorkspaceProps) {
  const { toast } = useStore();
  const mode = tool.id as 'edit' | 'sign' | 'redact';
  const file = items[0].file;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zoom, setZoom] = useState(1);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [active, setActive] = useState<ToolId>(mode === 'redact' ? 'redact' : 'select');
  const [style, setStyle] = useState<Style>({
    color: '#1f1a14',
    strokeWidth: 2,
    size: 14,
    font: 'sans',
    bold: false,
    fill: false,
    highlight: HIGHLIGHTS[0],
  });
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [signatures, setSignatures] = useState<Stamp[]>([]);
  const [signing, setSigning] = useState(false);
  const [query, setQuery] = useState('');
  const [flattenAll, setFlattenAll] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [, bump] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag | null>(null);
  const past = useRef<Obj[][]>([]);
  const future = useRef<Obj[][]>([]);
  const live = useRef<Obj[]>([]);
  live.current = objects;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await openPdf(file);
        const all: PageSize[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const v = (await d.getPage(i)).getViewport({ scale: 1 });
          all.push({ w: v.width, h: v.height });
        }
        if (!alive) return;
        const room = (scroller.current?.clientWidth ?? 900) - 56;
        const widest = Math.max(...all.map((s) => s.w));
        setZoom(Math.round(Math.min(1.5, Math.max(0.4, room / widest)) * 20) / 20);
        setSizes(all);
        setDoc(d);
      } catch (err: any) {
        if (alive) setLoadError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file]);

  /** Records the current state for undo, then applies the change. */
  const commit = useCallback((next: Obj[] | ((prev: Obj[]) => Obj[])) => {
    past.current.push(live.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setObjects(next);
    bump((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(live.current);
    setObjects(prev);
    setSelected(null);
    setEditing(null);
    bump((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(live.current);
    setObjects(next);
    setSelected(null);
    bump((n) => n + 1);
  }, []);

  const removeSelected = useCallback(() => {
    if (!selected) return;
    commit((prev) => prev.filter((o) => o.id !== selected));
    setSelected(null);
    setEditing(null);
  }, [selected, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (e.key === 'Escape') {
        if (typing && target.isContentEditable) target.blur();
        setSelected(null);
        setStamp(null);
        if (active === 'stamp') setActive('select');
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
        return;
      }
      const hit = TOOLSETS[mode].find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) setActive(hit.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, undo, redo, removeSelected, active]);

  const pointOf = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  };

  const onDown = useCallback(
    (e: React.PointerEvent, page: number) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const p = pointOf(e);
      const hitEl = target.closest<HTMLElement>('[data-obj]');
      const handle = target.dataset.handle;
      const current = live.current;

      if (hitEl && (active === 'select' || handle)) {
        const id = hitEl.dataset.obj!;
        const orig = current.find((o) => o.id === id)!;
        setSelected(id);
        if (editing && editing !== id) setEditing(null);
        if (editing === id) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { kind: handle ? 'resize' : 'move', id, page, startX: p.x, startY: p.y, orig, corner: handle, moved: false };
        return;
      }

      if (active === 'select') {
        setSelected(null);
        setEditing(null);
        return;
      }

      const id = uid();
      if (active === 'text') {
        e.preventDefault();
        commit((prev) => [
          ...prev,
          { id, page, type: 'text', x: p.x, y: p.y - style.size * 0.6, w: 0, h: 0, text: '', size: style.size, color: style.color, font: style.font, bold: style.bold },
        ]);
        setSelected(id);
        setEditing(id);
        setActive('select');
        return;
      }
      if (active === 'stamp' && stamp) {
        const w = Math.min(180, sizes[page].w * 0.4);
        const h = w / stamp.ratio;
        commit((prev) => [...prev, { id, page, type: 'image', src: stamp.src, x: p.x - w / 2, y: p.y - h / 2, w, h }]);
        setSelected(id);
        setStamp(null);
        setActive('select');
        return;
      }

      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      past.current.push(current);
      future.current = [];
      if (active === 'draw') {
        drag.current = { kind: 'draw', id, page, startX: p.x, startY: p.y, points: [[p.x, p.y]], moved: false };
        setObjects((prev) => [
          ...prev,
          { id, page, type: 'path', x: p.x, y: p.y, w: 1, h: 1, points: [[0, 0]], stroke: style.color, strokeWidth: style.strokeWidth },
        ]);
        return;
      }
      drag.current = { kind: 'create', id, page, startX: p.x, startY: p.y, moved: false };
      const box = { id, page, x: p.x, y: p.y, w: 0, h: 0 };
      let fresh: Obj;
      if (active === 'rect' || active === 'ellipse') {
        fresh = { ...box, type: active, stroke: style.color, strokeWidth: style.strokeWidth, fill: style.fill ? style.color : null };
      } else if (active === 'highlight') fresh = { ...box, type: 'highlight', color: style.highlight };
      else if (active === 'line') fresh = { ...box, type: 'line', stroke: style.color, strokeWidth: style.strokeWidth, flip: false };
      else if (active === 'whiteout') fresh = { ...box, type: 'whiteout' };
      else fresh = { ...box, type: 'redact' };
      setObjects((prev) => [...prev, fresh]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, zoom, style, stamp, editing, sizes, commit],
  );

  const onMove = useCallback(
    (e: React.PointerEvent, page: number) => {
      const d = drag.current;
      if (!d || d.page !== page) return;
      const p = pointOf(e);
      const dx = p.x - d.startX;
      const dy = p.y - d.startY;
      if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
      const size = sizes[page];

      const first = !d.moved;
      d.moved = true;
      if (first && (d.kind === 'move' || d.kind === 'resize')) {
        past.current.push(live.current);
        future.current = [];
      }

      if (d.kind === 'move' && d.orig) {
        const o = d.orig;
        const x = Math.min(Math.max(o.x + dx, -o.w + 8), size.w - 8);
        const y = Math.min(Math.max(o.y + dy, -o.h + 8), size.h - 8);
        setObjects((prev) => prev.map((it) => (it.id === d.id ? { ...it, x, y } : it)));
        return;
      }
      if (d.kind === 'resize' && d.orig) {
        const o = d.orig;
        let { x, y, w, h } = o;
        const c = d.corner!;
        if (c.includes('e')) w = Math.max(MIN_BOX, o.w + dx);
        if (c.includes('s')) h = Math.max(MIN_BOX, o.h + dy);
        if (c.includes('w')) {
          w = Math.max(MIN_BOX, o.w - dx);
          x = o.x + o.w - w;
        }
        if (c.includes('n')) {
          h = Math.max(MIN_BOX, o.h - dy);
          y = o.y + o.h - h;
        }
        if (o.type === 'image' && o.w > 0 && o.h > 0) {
          const ratio = o.w / o.h;
          h = w / ratio;
          if (c.includes('n')) y = o.y + o.h - h;
        }
        setObjects((prev) => prev.map((it) => (it.id === d.id ? { ...it, x, y, w, h } : it)));
        return;
      }
      if (d.kind === 'create') {
        const x = Math.max(0, Math.min(d.startX, p.x));
        const y = Math.max(0, Math.min(d.startY, p.y));
        const w = Math.min(size.w, Math.max(d.startX, p.x)) - x;
        const h = Math.min(size.h, Math.max(d.startY, p.y)) - y;
        setObjects((prev) =>
          prev.map((it) => (it.id === d.id ? ({ ...it, x, y, w, h, ...(it.type === 'line' ? { flip: dx * dy < 0 } : {}) } as Obj) : it)),
        );
        return;
      }
      if (d.kind === 'draw' && d.points) {
        d.points.push([p.x, p.y]);
        const xs = d.points.map((q) => q[0]);
        const ys = d.points.map((q) => q[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(Math.max(...xs) - x, 1);
        const h = Math.max(Math.max(...ys) - y, 1);
        const points = d.points.map(([qx, qy]) => [(qx - x) / w, (qy - y) / h] as [number, number]);
        setObjects((prev) => prev.map((it) => (it.id === d.id ? ({ ...it, x, y, w, h, points } as Obj) : it)));
      }
    },
    [zoom, sizes],
  );

  const onUp = useCallback(
    (_e: React.PointerEvent, page: number) => {
      const d = drag.current;
      if (!d || d.page !== page) return;
      drag.current = null;
      if (d.kind === 'create' || d.kind === 'draw') {
        const made = live.current.find((o) => o.id === d.id);
        const tooSmall =
          !made ||
          (d.kind === 'draw' ? (d.points?.length ?? 0) < 2 : made.type === 'line' ? Math.hypot(made.w, made.h) < MIN_BOX : made.w < MIN_BOX || made.h < MIN_BOX);
        if (tooSmall) {
          setObjects((prev) => prev.filter((o) => o.id !== d.id));
          past.current.pop();
        } else if (d.kind === 'create') {
          setSelected(d.id);
          // Keep marking with these; go back to the arrow for one-off shapes.
          if (!['highlight', 'redact', 'whiteout'].includes(active)) setActive('select');
        }
      }
      bump((n) => n + 1);
    },
    [active],
  );

  const onText = useCallback((id: string, text: string) => {
    setObjects((prev) => prev.map((o) => (o.id === id && o.type === 'text' ? { ...o, text } : o)));
  }, []);

  const onBlurText = useCallback((id: string) => {
    setEditing((cur) => (cur === id ? null : cur));
    setObjects((prev) => prev.filter((o) => !(o.id === id && o.type === 'text' && !o.text.trim())));
  }, []);

  const sel = objects.find((o) => o.id === selected) ?? null;

  const restyle = (patch: Partial<Style>) => {
    setStyle((s) => ({ ...s, ...patch }));
    if (!sel) return;
    commit((prev) =>
      prev.map((o) => {
        if (o.id !== sel.id) return o;
        if (o.type === 'text') {
          return { ...o, color: patch.color ?? o.color, size: patch.size ?? o.size, font: patch.font ?? o.font, bold: patch.bold ?? o.bold };
        }
        if (o.type === 'rect' || o.type === 'ellipse') {
          const stroke = patch.color ?? o.stroke;
          const filled = patch.fill ?? !!o.fill;
          return { ...o, stroke, strokeWidth: patch.strokeWidth ?? o.strokeWidth, fill: filled ? stroke : null };
        }
        if (o.type === 'line' || o.type === 'path') return { ...o, stroke: patch.color ?? o.stroke, strokeWidth: patch.strokeWidth ?? o.strokeWidth };
        if (o.type === 'highlight') return { ...o, color: patch.highlight ?? o.color };
        return o;
      }),
    );
  };

  const currentPage = () => {
    const el = scroller.current;
    if (!el) return 0;
    const mid = el.getBoundingClientRect().top + el.clientHeight / 3;
    let best = 0;
    el.querySelectorAll<HTMLElement>('.ed-page').forEach((node) => {
      if (node.getBoundingClientRect().top <= mid) best = Number(node.dataset.page);
    });
    return best;
  };

  const addImage = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        const keepAlpha = /png|webp|gif|svg/.test(f.type);
        setStamp({ src: c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.9), ratio: c.width / c.height });
        setActive('stamp');
        toast('Click the page where the image should go.');
      };
      img.onerror = () => toast('That file isn’t an image this browser can read.', 'error');
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const addDate = () => {
    const page = currentPage();
    const id = uid();
    const text = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    commit((prev) => [
      ...prev,
      { id, page, type: 'text', x: sizes[page].w * 0.1, y: sizes[page].h * 0.5, w: 0, h: 0, text, size: 12, color: '#1f1a14', font: 'sans', bold: false },
    ]);
    setSelected(id);
    setActive('select');
    toast('Date added. Drag it into place.');
  };

  const findAndRedact = async () => {
    const needle = query.trim().toLowerCase();
    if (!needle || !doc) return;
    const found: Obj[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items as any[]) {
        if (!item.str) continue;
        const hay = item.str.toLowerCase();
        let at = hay.indexOf(needle);
        while (at !== -1) {
          const t = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontH = Math.hypot(t[2], t[3]);
          const per = item.width / item.str.length;
          found.push({
            id: uid(),
            page: i,
            type: 'redact',
            x: t[4] + per * at - 1,
            y: t[5] - fontH * 0.95,
            w: per * needle.length + 2,
            h: fontH * 1.25,
          });
          at = hay.indexOf(needle, at + needle.length);
        }
      }
    }
    if (!found.length) return toast(`“${query.trim()}” doesn’t appear in the text of this PDF.`);
    commit((prev) => [...prev, ...found]);
    toast(`Covered ${plural(found.length, 'match', 'matches')}. Check each one before you save.`, 'success');
  };

  const marks = mode === 'redact' ? objects.filter((o) => o.type === 'redact') : objects;
  let problem = '';
  if (mode === 'redact' && !marks.length && !flattenAll) problem = 'Drag over anything you want gone.';
  if (mode === 'sign' && !objects.length) problem = 'Create a signature, then click the page to place it.';
  if (mode === 'edit' && !objects.length) problem = 'Pick a tool and add something to a page.';

  const save = () => {
    const clean = objects.filter((o) => o.type !== 'text' || o.text.trim());
    submit({
      kind: 'local',
      inputBytes: file.size,
      work: () => (mode === 'redact' ? redactPdf(file, clean, flattenAll) : applyEdits(file, clean, mode === 'sign' ? 'signed' : 'edited')),
    });
  };

  const byPage = useMemo(() => {
    const map = new Map<number, Obj[]>();
    for (const o of objects) map.set(o.page, [...(map.get(o.page) ?? []), o]);
    return map;
  }, [objects]);
  const none = useMemo<Obj[]>(() => [], []);

  const showText = sel ? sel.type === 'text' : active === 'text';
  const showStroke = sel ? ['rect', 'ellipse', 'line', 'path'].includes(sel.type) : ['rect', 'ellipse', 'line', 'draw'].includes(active);
  const showFill = sel ? sel.type === 'rect' || sel.type === 'ellipse' : active === 'rect' || active === 'ellipse';
  const showHighlight = sel ? sel.type === 'highlight' : active === 'highlight';
  const colourNow = sel && 'color' in sel && sel.type === 'text' ? sel.color : sel && 'stroke' in sel ? sel.stroke : style.color;

  const toolbar = (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOLSETS[mode].map((t) => (
        <button
          key={t.id}
          className={`tool-btn${active === t.id ? ' is-on' : ''}`}
          aria-pressed={active === t.id}
          aria-label={t.label}
          title={`${t.label}, ${t.key}`}
          onClick={() => {
            setActive(t.id);
            setStamp(null);
          }}
        >
          <t.icon size={20} strokeWidth={2} />
        </button>
      ))}
      {mode === 'edit' && (
        <button
          className={`tool-btn${active === 'stamp' ? ' is-on' : ''}`}
          aria-label="Image"
          title="Image"
          onClick={() => imageInput.current?.click()}
        >
          <ImagePlus size={20} strokeWidth={2} />
        </button>
      )}
      {mode === 'sign' && (
        <>
          <button className={`tool-btn${active === 'stamp' ? ' is-on' : ''}`} aria-label="Signature" title="Signature" onClick={() => setSigning(true)}>
            <Signature size={20} strokeWidth={2} />
          </button>
          <button className="tool-btn" aria-label="Today's date" title="Today's date" onClick={addDate}>
            <CalendarDays size={20} strokeWidth={2} />
          </button>
        </>
      )}
      <span className="toolbar-sep" />
      <button className="tool-btn" aria-label="Undo" title="Undo, Ctrl+Z" onClick={undo} disabled={!past.current.length}>
        <Undo2 size={20} strokeWidth={2} />
      </button>
      <button className="tool-btn" aria-label="Redo" title="Redo, Ctrl+Shift+Z" onClick={redo} disabled={!future.current.length}>
        <Redo2 size={20} strokeWidth={2} />
      </button>
      <span className="toolbar-sep" />
      <button className="tool-btn" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}>
        <Minus size={20} strokeWidth={2} />
      </button>
      <span className="mono toolbar-zoom">{Math.round(zoom * 100)}%</span>
      <button className="tool-btn" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>
        <Plus size={20} strokeWidth={2} />
      </button>
    </div>
  );

  const panel = (
    <>
      {mode === 'sign' && (
        <>
          <h3 className="panel-title">Sign this document</h3>
          <div className="panel-actions">
            <button className="btn btn-accent" onClick={() => setSigning(true)}>
              <Signature size={18} strokeWidth={2.2} />
              {signatures.length ? 'New signature' : 'Create your signature'}
            </button>
          </div>
          {signatures.length > 0 && (
            <div className="field">
              <span className="field-label">Place again</span>
              <div className="sig-saved">
                {signatures.map((s, i) => (
                  <button
                    key={i}
                    className="choice"
                    onClick={() => {
                      setStamp(s);
                      setActive('stamp');
                      toast('Click the page where it should go.');
                    }}
                  >
                    <img src={s.src} alt={`Signature ${i + 1}`} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="panel-note">
            This adds a visible signature to the page. It&rsquo;s the same as signing on paper and scanning; it isn&rsquo;t a
            certificate-based digital signature.
          </p>
        </>
      )}

      {mode === 'redact' && (
        <>
          <h3 className="panel-title">Black out content</h3>
          <p className="panel-note">Drag a box over anything that should disappear, or search for a word to cover every place it shows up.</p>
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              void findAndRedact();
            }}
          >
            <label className="field-label" htmlFor="redact-find">
              Find and cover
            </label>
            <div className="input-row">
              <input id="redact-find" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, number, email" />
              <button className="btn btn-accent" type="submit" aria-label="Find and cover" disabled={!query.trim()}>
                <Search size={18} strokeWidth={2.4} />
              </button>
            </div>
          </form>
          <p className="picked-count mono" aria-live="polite">
            {marks.length ? `${plural(marks.length, 'area')} marked` : 'Nothing marked yet'}
          </p>
          <label className="toggle-row">
            <input type="checkbox" className="toggle" checked={flattenAll} onChange={(e) => setFlattenAll(e.target.checked)} />
            <span>
              Flatten every page
              <small>Turns all pages into pictures, not only the ones with boxes. Use it for the most sensitive files.</small>
            </span>
          </label>
          <p className="panel-note">
            Pages with boxes are rebuilt as images, so the text under a box is removed from the file, not just hidden.
            Text on those pages stops being selectable; run OCR afterwards to get it back.
          </p>
        </>
      )}

      {mode === 'edit' && (
        <>
          <h3 className="panel-title">{sel ? 'Selected item' : 'Tool settings'}</h3>
          {!sel && active === 'select' && <p className="panel-note">Pick a tool from the bar, then click or drag on a page. Double-click text to change it.</p>}
        </>
      )}

      {mode !== 'redact' && (showText || showStroke || showFill) && (
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="color-row">
            <input type="color" value={colourNow} onChange={(e) => restyle({ color: e.target.value })} aria-label="Custom colour" />
            {COLOURS.map((c) => (
              <button
                key={c}
                className={`swatch${colourNow === c ? ' is-on' : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                onClick={() => restyle({ color: c })}
              />
            ))}
          </div>
        </div>
      )}
      {mode !== 'redact' && showHighlight && (
        <div className="field">
          <span className="field-label">Highlighter</span>
          <div className="color-row">
            {HIGHLIGHTS.map((c) => {
              const on = (sel?.type === 'highlight' ? sel.color : style.highlight) === c;
              return <button key={c} className={`swatch${on ? ' is-on' : ''}`} style={{ background: c }} aria-label={`Highlighter ${c}`} onClick={() => restyle({ highlight: c })} />;
            })}
          </div>
        </div>
      )}
      {mode !== 'redact' && showText && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="ed-size">
              Text size
            </label>
            <div className="range-row">
              <input id="ed-size" type="range" min={6} max={72} value={sel?.type === 'text' ? sel.size : style.size} onChange={(e) => restyle({ size: Number(e.target.value) })} />
              <output className="mono">{sel?.type === 'text' ? sel.size : style.size}pt</output>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ed-font">
              Font
            </label>
            <select id="ed-font" className="input" value={sel?.type === 'text' ? sel.font : style.font} onChange={(e) => restyle({ font: e.target.value as FontFamily })}>
              <option value="sans">Helvetica</option>
              <option value="serif">Times</option>
              <option value="mono">Courier</option>
            </select>
          </div>
          <label className="toggle-row">
            <input type="checkbox" className="toggle" checked={sel?.type === 'text' ? sel.bold : style.bold} onChange={(e) => restyle({ bold: e.target.checked })} />
            <span>Bold</span>
          </label>
        </>
      )}
      {mode !== 'redact' && showStroke && (
        <div className="field">
          <label className="field-label" htmlFor="ed-stroke">
            Line thickness
          </label>
          <div className="range-row">
            <input
              id="ed-stroke"
              type="range"
              min={1}
              max={16}
              value={sel && 'strokeWidth' in sel ? sel.strokeWidth : style.strokeWidth}
              onChange={(e) => restyle({ strokeWidth: Number(e.target.value) })}
            />
            <output className="mono">{sel && 'strokeWidth' in sel ? sel.strokeWidth : style.strokeWidth}pt</output>
          </div>
        </div>
      )}
      {mode !== 'redact' && showFill && (
        <label className="toggle-row">
          <input
            type="checkbox"
            className="toggle"
            checked={sel && (sel.type === 'rect' || sel.type === 'ellipse') ? !!sel.fill : style.fill}
            onChange={(e) => restyle({ fill: e.target.checked })}
          />
          <span>Fill the shape</span>
        </label>
      )}

      {sel && (
        <div className="btn-pair">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const id = uid();
              commit((prev) => [...prev, { ...sel, id, x: sel.x + 12, y: sel.y + 12 }]);
              setSelected(id);
            }}
          >
            <Copy size={16} strokeWidth={2.2} />
            Duplicate
          </button>
          <button className="btn btn-secondary btn-sm" onClick={removeSelected}>
            <Trash2 size={16} strokeWidth={2.2} />
            Delete
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <Shell
        tool={tool}
        title={file.name}
        meta={doc ? plural(doc.numPages, 'page') : undefined}
        onBack={reset}
        error={error || loadError}
        toolbar={toolbar}
        panel={panel}
        hint={problem}
        action={
          <button className="btn btn-primary btn-lg" onClick={save} disabled={!!problem || !doc}>
            {tool.action}
          </button>
        }
      >
        <div className={`ed-scroll${active === 'stamp' ? ' is-placing' : ''}`} ref={scroller}>
          {doc ? (
            sizes.map((size, i) => (
              <PageView
                key={i}
                doc={doc}
                index={i}
                size={size}
                zoom={zoom}
                objects={byPage.get(i) ?? none}
                selected={selected}
                editing={editing}
                tool={active}
                onDown={onDown}
                onMove={onMove}
                onUp={onUp}
                onEdit={setEditing}
                onText={onText}
                onBlurText={onBlurText}
              />
            ))
          ) : (
            !loadError && <div className="loading-block" aria-busy="true" />
          )}
        </div>
      </Shell>
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          addImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {signing && (
        <SignatureDialog
          onClose={() => setSigning(false)}
          onDone={(s) => {
            setSignatures((prev) => [...prev, s]);
            setStamp(s);
            setActive('stamp');
            setSigning(false);
            toast('Click the page where your signature should go.');
          }}
        />
      )}
    </>
  );
}
