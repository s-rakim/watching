import { Plus } from 'lucide-react';
import { DragEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { extOf, plural } from '../lib/format';
import { ToolDef } from '../tools';

export function acceptAttr(tool: ToolDef): string {
  return tool.accept.map((e) => `.${e}`).join(',');
}

/** Splits dropped files into the ones a tool takes and the ones it doesn't. */
export function sortFiles(tool: ToolDef, files: File[]): { ok: File[]; bad: File[] } {
  const ok: File[] = [];
  const bad: File[] = [];
  for (const f of files) (tool.accept.includes(extOf(f.name)) ? ok : bad).push(f);
  return { ok, bad };
}

interface Props {
  tool: ToolDef;
  onFiles: (files: File[]) => void;
  maxMb?: number;
  children?: ReactNode;
}

export default function Dropzone({ tool, onFiles, maxMb, children }: Props) {
  const [depth, setDepth] = useState(0);
  const [count, setCount] = useState(0);
  const [problem, setProblem] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number>();

  const take = (list: File[]) => {
    const { ok, bad } = sortFiles(tool, list);
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
      className={`dropzone${dragging ? ' is-dragging' : ''}${problem ? ' is-rejected' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDepth((d) => d + 1);
        setCount(e.dataTransfer.items?.length ?? 0);
      }}
      onDragLeave={() => setDepth((d) => Math.max(0, d - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <span className="tile tile-lg">
        <tool.icon size={40} strokeWidth={2} />
      </span>
      {dragging ? (
        <p className="dropzone-title">Let go to add {count > 1 ? plural(count, 'file') : 'it'}</p>
      ) : (
        <>
          <p className="dropzone-title">Drop {many} here</p>
          <label className="btn btn-primary btn-lg">
            <Plus size={20} strokeWidth={2.4} />
            Choose {tool.multiple ? 'files' : 'a file'}
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept={acceptAttr(tool)}
              multiple={tool.multiple}
              onChange={(e) => {
                take(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </label>
        </>
      )}
      {children}
      <p className={`dropzone-note${problem ? ' is-problem' : ''}`} role={problem ? 'alert' : undefined}>
        {problem ||
          (tool.local
            ? 'This tool works right in your browser. Nothing leaves this machine.'
            : `Up to ${maxMb ?? 500} MB each. Nothing leaves this machine.`)}
      </p>
    </div>
  );
}
