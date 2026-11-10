import { ArrowLeft, CircleAlert } from 'lucide-react';
import { ReactNode } from 'react';
import { Crumbs } from '../App';
import { CATEGORIES, ToolDef } from '../tools';

interface Props {
  tool: ToolDef;
  title: string;
  meta?: string;
  onBack: () => void;
  bar?: ReactNode;
  panel?: ReactNode;
  action: ReactNode;
  /** One line shown beside the action button, such as what is still missing. */
  hint?: string;
  error?: string;
  children: ReactNode;
  toolbar?: ReactNode;
}

/** The frame every full-screen tool shares: breadcrumbs, a dark canvas, the action bar and a sidebar. */
export default function Shell({ tool, title, meta, onBack, bar, panel, action, hint, error, children, toolbar }: Props) {
  const family = CATEGORIES.find((c) => c.id === tool.category)!;
  return (
    <>
      <div className="content">
        <Crumbs trail={[{ label: 'All tools', to: '/' }, { label: family.name }, { label: tool.name }]}>{bar}</Crumbs>
        <div className="canvas">
          {toolbar && <div className="toolbar-dock">{toolbar}</div>}
          {children}
        </div>
        <div className="action-bar">
          <button className="btn btn-ghost" onClick={onBack}>
            <ArrowLeft size={18} strokeWidth={2} />
            <span className="hide-narrow">Start over</span>
          </button>
          {error ? (
            <p className="note note-error" role="alert">
              <CircleAlert size={18} strokeWidth={2} />
              {error}
            </p>
          ) : (
            <p className="action-summary">
              <span className="action-file" title={title}>{title}</span>
              {meta && <span className="mono"> · {meta}</span>}
              {hint && <span className="action-hint">{hint}</span>}
            </p>
          )}
          {action}
        </div>
      </div>
      <aside className="sidebar" aria-label={`${tool.name} options`}>
        <div className="sidebar-head">
          <span className="tile">
            <tool.icon size={22} strokeWidth={1.8} />
          </span>
          <div>
            <h2>{tool.name}</h2>
            <p>{tool.blurb}</p>
          </div>
        </div>
        <div className="sidebar-body">{panel}</div>
      </aside>
    </>
  );
}
