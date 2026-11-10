import { Camera, CircleStop } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { plural } from '../lib/format';

interface Props {
  onShots: (files: File[]) => void;
  compact?: boolean;
}

/** Live camera view with a shutter button. Each shot comes back as a JPEG file. */
export default function CameraPanel({ onShots, compact }: Props) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const [taken, setTaken] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  };
  useEffect(() => stop, []);

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t reach a camera here. Cameras only work on localhost or over HTTPS.');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false,
      });
      setOn(true);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch {
      setError('The camera couldn’t be opened. Check that this page is allowed to use it.');
    }
  };

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const n = taken + 1;
        setTaken(n);
        onShots([new File([blob], `scan-${String(n).padStart(2, '0')}.jpg`, { type: 'image/jpeg' })]);
      },
      'image/jpeg',
      0.92,
    );
  };

  if (!on) {
    return (
      <div className={`camera${compact ? ' camera-compact' : ''}`}>
        <button className={compact ? 'btn btn-accent' : 'btn btn-secondary'} onClick={start}>
          <Camera size={20} strokeWidth={2.2} />
          {compact ? 'Scan another page' : 'Use the camera'}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="camera camera-live">
      <video ref={video} playsInline muted />
      <div className="camera-bar">
        <span className="mono">{taken ? `${plural(taken, 'page')} scanned` : 'Line the page up and shoot'}</span>
        <button className="shutter" onClick={shoot} aria-label="Take a photo" />
        <button className="btn btn-ghost btn-sm" onClick={stop}>
          <CircleStop size={18} strokeWidth={2} />
          Done
        </button>
      </div>
    </div>
  );
}
