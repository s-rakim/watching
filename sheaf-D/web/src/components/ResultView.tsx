import { ArrowRight, Check, Download, RotateCcw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Result, saveBlob } from '../lib/api';
import { bytes, extOf, plural } from '../lib/format';
import { passFiles } from '../lib/store';
import { FOLLOW_UPS, ToolDef, toolById } from '../tools';

interface Props {
  tool: ToolDef;
  result: Result;
  onAgain: () => void;
}

const DONE: Record<string, string> = {
  merge: 'Your PDFs are now one file',
  split: 'Your PDF has been split',
  compress: 'Your PDF is smaller',
  protect: 'Your PDF is locked',
  unlock: 'Your PDF is unlocked',
  sign: 'Your document is signed',
  redact: 'The covered areas are gone for good',
  ocr: 'Your PDF is searchable now',
  repair: 'Your PDF has been repaired',
};

export default function ResultView({ tool, result, onAgain }: Props) {
  const navigate = useNavigate();
  const isPdf = extOf(result.name) === 'pdf';

  useEffect(() => {
    // Start the download straight away, like people expect.
    saveBlob(result.blob, result.name);
  }, [result]);

  const detail = useMemo(() => {
    const out = result.blob.size;
    if (tool.id === 'compress' && result.inputBytes > 0) {
      const saved = Math.round((1 - out / result.inputBytes) * 100);
      return saved > 0
        ? `${bytes(result.inputBytes)} to ${bytes(out)}, ${saved}% smaller`
        : `${bytes(out)}. It was already as small as it gets.`;
    }
    if (result.count > 1) return `${plural(result.count, 'file')} in a zip, ${bytes(out)}`;
    return bytes(out);
  }, [result, tool.id]);

  const next = FOLLOW_UPS.filter((id) => id !== tool.id)
    .map((id) => toolById(id)!)
    .slice(0, 7);

  return (
    <div className="result">
      <span className="tile tile-lg result-tile">
        <Check size={44} strokeWidth={2.6} />
      </span>
      <h2>{DONE[tool.id] ?? 'All done'}</h2>
      <p className="result-name">{result.name}</p>
      <p className="mono result-detail">{detail}</p>
      <div className="result-actions">
        <button className="btn btn-primary btn-lg" onClick={() => saveBlob(result.blob, result.name)}>
          <Download size={20} strokeWidth={2.4} />
          Download {result.count > 1 ? 'zip' : extOf(result.name).toUpperCase()}
        </button>
        <button className="btn btn-secondary" onClick={onAgain}>
          <RotateCcw size={18} strokeWidth={2.2} />
          Start over
        </button>
      </div>

      {isPdf && (
        <div className="continue">
          <p className="continue-title">Continue with</p>
          <div className="chips chips-center">
            {next.map((t) => (
              <button
                key={t.id}
                className="chip chip-tool"
                data-category={t.category}
                onClick={() => {
                  passFiles(t.id, [new File([result.blob], result.name, { type: 'application/pdf' })]);
                  navigate(`/${t.id}`);
                }}
              >
                <t.icon size={16} strokeWidth={2.2} />
                {t.name}
                <ArrowRight size={14} strokeWidth={2.4} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
