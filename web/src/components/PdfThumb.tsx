import { useEffect, useRef, useState } from 'react';
import { openPdf, renderPage } from '../lib/pdf';

interface Props {
  file: File;
  page?: number;
  width: number;
  rotation?: number;
  onInfo?: (pages: number) => void;
}

/** A page preview that only renders once it scrolls into view. */
export default function PdfThumb({ file, page = 1, width, rotation = 0, onInfo }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(1.414);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      try {
        const doc = await openPdf(file);
        onInfo?.(doc.numPages);
        const p = await doc.getPage(page);
        if (!alive || !canvas.current) return;
        // Rendered once upright; extra turns are a CSS transform so they animate.
        const size = await renderPage(p, canvas.current, Math.max(width, 160));
        if (!alive) return;
        setRatio(size.height / size.width);
        setState('ready');
      } catch {
        if (alive) setState('failed');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, file, page]);

  const turned = rotation % 180 !== 0;
  const box = turned ? { width, height: width / ratio } : { width, height: width * ratio };
  const inner = turned ? { width: width / ratio, height: width } : box;

  return (
    <div
      ref={holder}
      className={`thumb thumb-${state}`}
      style={box}
    >
      <canvas
        ref={canvas}
        style={{
          width: inner.width,
          height: inner.height,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        }}
      />
      {state === 'failed' && <span className="thumb-failed">No preview</span>}
    </div>
  );
}
