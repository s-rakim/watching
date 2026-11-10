import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Crumbs } from '../App';
import { useStore } from '../lib/store';
import { CATEGORIES, Category, TOOLS, ToolDef } from '../tools';

export function ToolCard({ tool, unavailable }: { tool: ToolDef; unavailable?: boolean }) {
  return (
    <Link to={`/${tool.id}`} className="tool-card" data-category={tool.category}>
      <span className="tile">
        <tool.icon size={24} strokeWidth={1.8} />
      </span>
      <span className="tool-card-name">{tool.name}</span>
      <span className="tool-card-blurb">{tool.blurb}</span>
      {unavailable && <span className="badge badge-warning">Needs setup</span>}
    </Link>
  );
}

export default function Home() {
  const { health } = useStore();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const query = (params.get('q') ?? '').trim();

  const shown = useMemo(() => {
    const q = query.toLowerCase();
    return TOOLS.filter(
      (t) => (filter === 'all' || t.category === filter) && (!q || `${t.name} ${t.blurb}`.toLowerCase().includes(q)),
    );
  }, [filter, query]);

  const missing = (t: ToolDef) => !!health && !!t.needs?.some((n) => !health[n]);
  const groups = CATEGORIES.map((c) => ({ ...c, tools: shown.filter((t) => t.category === c.id) })).filter((g) => g.tools.length);

  return (
    <div className="content">
      <Crumbs trail={[{ label: 'All tools' }]} />
      <div className="content-scroll">
        <div className="page">
          <section className="hero">
            <h1>Every PDF tool, on your own machine</h1>
            <p>
              Merge, split, compress, convert, sign and edit. {TOOLS.length} tools in one place, and your files never
              leave this server.
            </p>
          </section>

          <div className="chips" role="tablist" aria-label="Tool families">
            <button role="tab" aria-selected={filter === 'all'} className="chip" onClick={() => setFilter('all')}>
              All
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={filter === c.id}
                className="chip"
                data-category={c.id}
                onClick={() => setFilter(c.id)}
              >
                <span className="nav-dot" />
                {c.name}
              </button>
            ))}
          </div>

          {groups.length ? (
            groups.map((g) => (
              <section key={g.id} className="tool-section" data-category={g.id}>
                <h2>
                  <span className="nav-dot" />
                  {g.name}
                </h2>
                <div className="tool-grid">
                  {g.tools.map((t) => (
                    <ToolCard key={t.id} tool={t} unavailable={missing(t)} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="empty">
              <h2>No tool matches &ldquo;{query}&rdquo;</h2>
              <p>Try a shorter word, like &ldquo;merge&rdquo; or &ldquo;word&rdquo;.</p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setFilter('all');
                  navigate('/');
                }}
              >
                Show all tools
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
