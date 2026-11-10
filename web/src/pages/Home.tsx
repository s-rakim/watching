import { HardDrive, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { CATEGORIES, Category, TOOLS, ToolDef } from '../tools';

export function ToolCard({ tool, index = 0, unavailable }: { tool: ToolDef; index?: number; unavailable?: boolean }) {
  return (
    <Link
      to={`/${tool.id}`}
      className="tool-card"
      data-category={tool.category}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <span className="tile">
        <tool.icon size={28} strokeWidth={2} />
      </span>
      <span className="tool-card-name">{tool.name}</span>
      <span className="tool-card-blurb">{tool.blurb}</span>
      {unavailable && <span className="badge badge-warning">Needs setup</span>}
    </Link>
  );
}

export default function Home() {
  const { health } = useStore();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOOLS.filter(
      (t) =>
        (filter === 'all' || t.category === filter) &&
        (!q || `${t.name} ${t.blurb}`.toLowerCase().includes(q)),
    );
  }, [filter, query]);

  const missing = (t: ToolDef) => !!health && !!t.needs?.some((n) => !health[n]);

  return (
    <main id="main" className="container home">
      <section className="hero">
        <span className="badge hero-badge">
          <HardDrive size={14} strokeWidth={2.2} />
          Runs on your machine
        </span>
        <h1>
          Every PDF tool you need, <span className="hero-mark">none of the uploading.</span>
        </h1>
        <p>
          Merge, split, compress, convert, sign and edit. {TOOLS.length} tools in one place, and your files stay on this
          computer the whole time.
        </p>
      </section>

      <div className="filters">
        <div className="tabs" role="tablist" aria-label="Tool families">
          <button role="tab" aria-selected={filter === 'all'} className="tab" onClick={() => setFilter('all')}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={filter === c.id}
              className="tab"
              data-category={c.id}
              onClick={() => setFilter(c.id)}
            >
              <span className="dot" />
              {c.short}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={18} strokeWidth={2} />
          <span className="sr-only">Find a tool</span>
          <input type="search" placeholder="Find a tool" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {shown.length ? (
        <div className="tool-grid" key={filter}>
          {shown.map((t, i) => (
            <ToolCard key={t.id} tool={t} index={i} unavailable={missing(t)} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>No tool matches &ldquo;{query}&rdquo;.</p>
          <button className="btn btn-secondary" onClick={() => { setQuery(''); setFilter('all'); }}>
            Show all tools
          </button>
        </div>
      )}
    </main>
  );
}
