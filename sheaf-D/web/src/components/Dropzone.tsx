import { Plus } from 'lucide-react';
import { DragEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { isAndroid, looksLikePdf } from '../lib/device';
import { extOf, plural } from '../lib/format';
import { ToolDef } from '../tools';

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff']);

// Android passes the accept list on to whichever file app is installed, and many of them
// tag documents as application/octet-stream. Those files come up greyed out and can't be
// tapped, so on Android the picker lets everything through and sortFiles checks the
// result. Image-only tools keep their filter so Android still opens its photo picker.
export function acceptAttr(tool: ToolDef): string {
  if (isAndroid && !tool.accept.every((e) => IMAGE_EXTS.has(e))) return '';
  return tool.accept.map((e) => `.${e}`).join(',');
}

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'text/csv': 'csv',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'text/html': 'html',
};

async function fits(tool: ToolDef, f: File): Promise<boolean> {
  const ext = extOf(f.name);
  if (tool.accept.includes(ext)) return true;
  const fromType = MIME_EXT[f.type];
  if (fromType) return tool.accept.includes(fromType) || (fromType === 'jpg' && tool.accept.includes('jpeg'));
  // Picked from a content provider with a bare name like "document" or "12345".
  return tool.accept.includes('pdf') && looksLikePdf(f);
}

/** Splits picked or dropped files into the ones a tool takes and the ones it doesn't. */
export async function sortFiles(tool: ToolDef, files: File[]): Promise<{ ok: File[]; bad: File[] }> {
  const ok: File[] = [];
  const bad: File[] = [];
  const checks = await Promise.all(files.map((f) => fits(tool, f)));
  files.forEach((f, i) => (checks[i] ? ok : bad).push(f));
  return { ok, bad };
}

interface Props {
  tool: ToolDef;
  onFiles: (files: File[]) => void;
  maxMb?: number;
  children?: ReactNode;
  /** Shrinks to a slim bar once files have been added. */
  compact?: boolean;
}

export default function Dropzone({ tool, onFiles, maxMb, children, compact }: Props) {
  const [depth, setDepth] = useState(0);
  const [count, setCount] = useState(0);
  const [problem, setProblem] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number>();

  const take = async (list: File[]) => {
    const { ok, bad } = await sortFiles(tool, list);
    const limit = (maxMb ?? 500) * 1024 * 1024;
    const tooBig = tool.local ? [] : ok.filter((f) => f.size > limit);
    const good = ok.filter((f) => !tooBig.includes(f));
    if (bad.length || tooBig.length) {
      setProblem(
        bad.length
          ? `${bad[0].name} isn’t a ${tool.noun}. This tool takes ${tool.accept.map((e) => e.toUpperCase()).join(', ')}.`
          : `${tooBig[0].name} is over the ${maxMb} MB limit.`,
      );
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setProblem(''), 4000);
    }
    if (good.length) onFiles(tool.multiple ? good : good.slice(0, 1));
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) take(files);
    };
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDepth(0);
    take(Array.from(e.dataTransfer.files));
  };

  const dragging = depth > 0;
  const many = tool.multiple ? `${tool.noun}s` : `a ${tool.noun}`;

  return (
    <div
      className={`dropzone${compact ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}${problem ? ' is-rejected' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDepth((d) => d + 1);
        setCount(e.dataTransfer.items?.length ?? 0);
      }}
      onDragLeave={() => setDepth((d) => Math.max(0, d - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {!compact && (
        <span className="tile tile-xl">
          <tool.icon size={32} strokeWidth={1.8} />
        </span>
      )}
      {dragging ? (
        <p className="dropzone-title">Let go to add {count > 1 ? plural(count, 'file') : 'it'}</p>
      ) : (
        <>
          <p className="dropzone-title">{compact ? (tool.multiple ? 'Drop more files here' : 'Drop a different file here') : `Drop ${many} here`}</p>
          <label className="btn btn-secondary has-pick">
            <Plus size={18} strokeWidth={2} />
            {compact && !tool.multiple ? 'Replace file' : `Choose ${tool.multiple ? 'files' : 'a file'}`}
            <input
              ref={input}
              type="file"
              className="pick"
              accept={acceptAttr(tool)}
              multiple={tool.multiple}
              onChange={(e) => {
                void take(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        </>
      )}
      {children}
      {(problem || !compact) && (
        <p className={`dropzone-note${problem ? ' is-problem' : ''}`} role={problem ? 'alert' : undefined}>
          {problem ||
            (tool.local
              ? 'This tool works right in your browser. Nothing leaves this machine.'
              : `Up to ${maxMb ?? 500} MB each. Files stay on this server.`)}
        </p>
      )}
    </div>
  );
}
