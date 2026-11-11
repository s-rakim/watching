import '@fontsource/caveat/600.css';
import '@fontsource/dancing-script/600.css';
import '@fontsource/sacramento/400.css';
import { Eraser, PenLine, Type, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { trimCanvas } from '../lib/pdfEdit';

export interface Stamp {
  src: string;
  /** Width divided by height. */
  ratio: number;
}

interface Props {
  onDone: (stamp: Stamp) => void;
  onClose: () => void;
}

const INKS = ['#1f1a14', '#0a3d91', '#b0141c'];
const HANDS = [
  { css: '"Caveat", cursive', weight: 600 },
  { css: '"Dancing Script", cursive', weight: 600 },
  { css: '"Sacramento", cursive', weight: 400 },
];

export default function SignatureDialog({ onDone, onClose }: Props) {
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [ink, setInk] = useState(INKS[0]);
  const [name, setName] = useState('');
  const [hand, setHand] = useState(0);
  const [hasInk, setHasInk] = useState(false);
  const [upload, setUpload] = useState<Stamp | null>(null);
  const [problem, setProblem] = useState('');
  const pad = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const c = pad.current;
    if (!c || tab !== 'draw') return;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * 2;
    c.height = rect.height * 2;
    setHasInk(false);
  }, [tab]);

  const point = (e: React.PointerEvent) => {
    const rect = pad.current!.getBoundingClientRect();
    return [(e.clientX - rect.left) * 2, (e.clientY - rect.top) * 2] as const;
  };

  const down = (e: React.PointerEvent) => {
    const ctx = pad.current!.getContext('2d')!;
    pad.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const [x, y] = point(e);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setHasInk(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = pad.current!.getContext('2d')!;
    const [x, y] = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const clear = () => {
    const c = pad.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const typed = async (): Promise<Stamp | null> => {
    const font = HANDS[hand];
    const spec = `${font.weight} 160px ${font.css}`;
    await document.fonts.load(spec, name);
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    ctx.font = spec;
    c.width = Math.ceil(ctx.measureText(name).width) + 120;
    c.height = 360;
    ctx.font = spec;
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 60, 180);
    const t = trimCanvas(c);
    return t ? { src: t.src, ratio: t.width / t.height } : null;
  };

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // Paper-white backgrounds become transparent so the signature sits on the page.
      const data = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < data.data.length; i += 4) {
        const light = Math.min(data.data[i], data.data[i + 1], data.data[i + 2]);
        if (light > 225) data.data[i + 3] = 0;
        else if (light > 180) data.data[i + 3] = Math.round(((225 - light) / 45) * 255);
      }
      ctx.putImageData(data, 0, 0);
      const t = trimCanvas(c);
      URL.revokeObjectURL(url);
      if (t) setUpload({ src: t.src, ratio: t.width / t.height });
      else setProblem('That image looks blank.');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setProblem('That file isn’t an image this browser can read.');
    };
    img.src = url;
  };

  const finish = async () => {
    let stamp: Stamp | null = null;
    if (tab === 'draw') {
      const t = pad.current && trimCanvas(pad.current);
      stamp = t ? { src: t.src, ratio: t.width / t.height } : null;
    } else if (tab === 'type') stamp = name.trim() ? await typed() : null;
    else stamp = upload;
    if (!stamp) return setProblem(tab === 'draw' ? 'Draw your signature first.' : tab === 'type' ? 'Type your name first.' : 'Choose an image first.');
    onDone(stamp);
  };

  const ready = tab === 'draw' ? hasInk : tab === 'type' ? !!name.trim() : !!upload;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="sig-title" tabIndex={-1} ref={dialog}>
        <div className="dialog-head">
          <h2 id="sig-title">Your signature</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>
        <div className="tabs tabs-fill" role="tablist">
          {(
            [
              ['draw', 'Draw', PenLine],
              ['type', 'Type', Type],
              ['upload', 'Upload', Upload],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => { setTab(id); setProblem(''); }}>
              <Icon size={16} strokeWidth={2.2} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'draw' && (
          <div className="sig-pad-wrap">
            <canvas
              ref={pad}
              className="sig-pad"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={() => (drawing.current = false)}
              onPointerCancel={() => (drawing.current = false)}
              aria-label="Signature drawing area"
            />
            <button className="btn btn-ghost btn-sm sig-clear" onClick={clear}>
              <Eraser size={16} strokeWidth={2.2} />
              Clear
            </button>
          </div>
        )}

        {tab === 'type' && (
          <div className="sig-type">
            <label className="field-label" htmlFor="sig-name">
              Your name
            </label>
            <input id="sig-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="sig-hands" role="radiogroup" aria-label="Handwriting style">
              {HANDS.map((h, i) => (
                <button
                  key={h.css}
                  role="radio"
                  aria-checked={hand === i}
                  className="choice sig-hand"
                  style={{ fontFamily: h.css, fontWeight: h.weight, color: ink }}
                  onClick={() => setHand(i)}
                >
                  {name || 'Your name'}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <label className="sig-upload has-pick">
            {upload ? <img src={upload.src} alt="Your uploaded signature" /> : <span>Choose a photo or scan of your signature</span>}
            <input type="file" accept="image/*" className="pick" onChange={(e) => onUpload(e.target.files?.[0])} />
          </label>
        )}

        <div className="dialog-foot">
          {tab !== 'upload' && (
            <div className="color-row" role="radiogroup" aria-label="Ink colour">
              {INKS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={ink === c}
                  aria-label={`Ink ${c}`}
                  className={`swatch${ink === c ? ' is-on' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setInk(c);
                    if (tab === 'draw') clear();
                  }}
                />
              ))}
            </div>
          )}
          {problem && (
            <p className="form-error" role="alert">
              {problem}
            </p>
          )}
          <button className="btn btn-primary" onClick={finish} disabled={!ready}>
            Use this signature
          </button>
        </div>
      </div>
    </div>
  );
}
