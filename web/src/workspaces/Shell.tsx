import { ArrowLeft, CircleAlert } from 'lucide-react';
import { ReactNode } from 'react';
import { ToolDef } from '../tools';

interface Props {
  tool: ToolDef;
  title: string;
  meta?: string;
  onBack: () => void;
  bar?: ReactNode;
  panel?: ReactNode;
  action: ReactNode;
  error?: string;
  children: ReactNode;
  toolbar?: ReactNode;
}

/** The frame every full-screen tool shares: top bar, sunk canvas, side panel. */
export default function Shell({ tool, title, meta, onBack, bar, panel, action, error, children, toolbar }: Props) {
  return (
    <div className="ws">
      <div className="ws-bar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={2.2} />
          Back
        </button>
        <span className="tile tile-sm">
          <tool.icon size={18} strokeWidth={2.2} />
        </span>
        <div className="ws-title">
          <strong>{tool.name}</strong>
          <span title={title}>
            {title}
            {meta && <em className="mono"> · {meta}</em>}
          </span>
        </div>
        <div className="ws-bar-extra">{bar}</div>
      </div>
      <div className="ws-body">
        <div className="ws-canvas">
          {toolbar && <div className="ws-toolbar-dock">{toolbar}</div>}
          {children}
        </div>
        <aside className="panel ws-panel">
          {panel}
          <div className="panel-foot">
            {error && (
              <p className="form-error" role="alert">
                <CircleAlert size={18} strokeWidth={2.2} />
                {error}
              </p>
            )}
            {action}
          </div>
        </aside>
      </div>
    </div>
  );
}
