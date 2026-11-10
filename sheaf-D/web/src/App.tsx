import { Check, ChevronRight, CircleAlert, CircleCheck, Info, LayoutGrid, Menu, Search, Settings, WifiOff, X } from 'lucide-react';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from './lib/store';
import Home from './pages/Home';
import ToolPage from './pages/ToolPage';
import { CATEGORIES, TOOLS, toolById } from './tools';

type Theme = 'auto' | 'light' | 'dark';
const BACKDROPS = ['blue', 'tomato', 'jade', 'marigold', 'pink', 'lime', 'ink'] as const;
type Backdrop = (typeof BACKDROPS)[number];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode, nothing to save
  }
}

const NavToggle = createContext<() => void>(() => {});

export function Logo() {
  return (
    <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="6" y="20" width="34" height="38" rx="9" fill="#ffb31f" transform="rotate(-12 23 39)" />
      <rect x="16" y="13" width="34" height="38" rx="9" fill="#1fc7a6" transform="rotate(-2 33 32)" />
      <rect x="25" y="7" width="34" height="38" rx="9" fill="#ff6b3d" stroke="#fff" strokeWidth="2" transform="rotate(9 42 26)" />
    </svg>
  );
}

/** The sticky bar at the top of the content area: where you are, plus page-specific controls. */
export function Crumbs({ trail, children }: { trail: { label: string; to?: string }[]; children?: ReactNode }) {
  const toggle = useContext(NavToggle);
  return (
    <div className="crumbs">
      <button className="icon-btn nav-toggle" aria-label="Open navigation" onClick={toggle}>
        <Menu size={20} strokeWidth={2} />
      </button>
      <nav aria-label="Breadcrumb" className="crumbs-trail">
        {trail.map((c, i) => (
          <span key={c.label} className="crumb">
            {i > 0 && <ChevronRight size={16} strokeWidth={2} className="crumb-sep" aria-hidden="true" />}
            {c.to ? (
              <Link to={c.to}>{c.label}</Link>
            ) : (
              <span aria-current={i === trail.length - 1 ? 'page' : undefined}>{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="crumbs-extra">{children}</div>
    </div>
  );
}

function Navigation({ open, onClose, onSettings }: { open: boolean; onClose: () => void; onSettings: () => void }) {
  const { pathname } = useLocation();
  const current = toolById(pathname.slice(1));
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(read('sheaf-nav') ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => write('sheaf-nav', JSON.stringify(expanded)), [expanded]);
  useEffect(() => {
    if (current) setExpanded((e) => (e[current.category] ? e : { ...e, [current.category]: true }));
  }, [current]);

  return (
    <>
      {open && <div className="nav-scrim" onClick={onClose} />}
      <nav className={`nav${open ? ' is-open' : ''}`} aria-label="Tools">
        <div className="nav-scroll">
          <NavLink to="/" end className="nav-item">
            <LayoutGrid size={20} strokeWidth={1.8} />
            <span className="nav-label">All tools</span>
            <span className="counter">{TOOLS.length}</span>
          </NavLink>
          {CATEGORIES.map((cat) => {
            const tools = TOOLS.filter((t) => t.category === cat.id);
            const isOpen = !!expanded[cat.id];
            return (
              <div key={cat.id} className="nav-group" data-category={cat.id}>
                <button
                  className="nav-item nav-group-head"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((e) => ({ ...e, [cat.id]: !isOpen }))}
                >
                  <span className="nav-dot" />
                  <span className="nav-label">{cat.name}</span>
                  <span className="counter">{tools.length}</span>
                  <ChevronRight size={16} strokeWidth={2} className="nav-chevron" />
                </button>
                {isOpen && (
                  <div className="nav-children">
                    {tools.map((t) => (
                      <NavLink key={t.id} to={`/${t.id}`} className="nav-item nav-child">
                        <t.icon size={18} strokeWidth={1.8} />
                        <span className="nav-label">{t.name}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="nav-foot">
          <button className="nav-item" onClick={onSettings}>
            <Settings size={20} strokeWidth={1.8} />
            <span className="nav-label">Settings</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function SettingsDialog({
  theme,
  setTheme,
  backdrop,
  setBackdrop,
  onClose,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  backdrop: Backdrop;
  setBackdrop: (b: Backdrop) => void;
  onClose: () => void;
}) {
  const { health } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  const engines: [string, boolean | undefined][] = [
    ['qpdf', health?.qpdf],
    ['Ghostscript', health?.ghostscript],
    ['LibreOffice', health?.libreoffice],
    ['OCR (Tesseract)', health?.ocr],
    ['Poppler', health?.poppler],
    ['Chromium', health?.chromium],
    ['Python converters', health?.python],
  ];

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={ref}>
        <div className="dialog-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <div className="field">
          <span className="field-label" id="theme-label">Theme</span>
          <div className="choices choices-compact" role="radiogroup" aria-labelledby="theme-label">
            {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} className="choice" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)}>
                <span className="choice-text">
                  <strong>{t === 'auto' ? 'System' : t === 'light' ? 'Light' : 'Dark'}</strong>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label" id="backdrop-label">Background</span>
          <div className="color-row" role="radiogroup" aria-labelledby="backdrop-label">
            {BACKDROPS.map((b) => (
              <button
                key={b}
                role="radio"
                aria-checked={backdrop === b}
                aria-label={b}
                title={b}
                data-backdrop={b}
                className={`swatch swatch-lg${backdrop === b ? ' is-on' : ''}`}
                style={{ background: 'var(--color-background-plain)', color: 'var(--color-background-plain-text)' }}
                onClick={() => setBackdrop(b)}
              >
                {backdrop === b && <Check size={18} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">What this server has installed</span>
          <ul className="engine-list">
            {engines.map(([name, ok]) => (
              <li key={name}>
                {ok ? <CircleCheck size={18} className="ok" /> : <CircleAlert size={18} className="missing" />}
                <span>{name}</span>
                <span className="muted">{ok === undefined ? 'unknown' : ok ? 'ready' : 'missing'}</span>
              </li>
            ))}
          </ul>
          <p className="field-hint">
            Uploads can be up to {health?.maxUploadMb ?? 500} MB each. Files are deleted from the server as soon as your
            download is sent.
          </p>
        </div>
      </div>
    </div>
  );
}

function HeaderSearch() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [value, setValue] = useState(params.get('q') ?? '');
  useEffect(() => {
    if (pathname !== '/') setValue('');
  }, [pathname]);
  return (
    <label className="header-search">
      <Search size={18} strokeWidth={2} />
      <span className="sr-only">Find a tool</span>
      <input
        type="search"
        placeholder="Find a tool"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          navigate(e.target.value ? `/?q=${encodeURIComponent(e.target.value)}` : '/', { replace: pathname === '/' });
        }}
      />
    </label>
  );
}

function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.tone === 'error' ? CircleAlert : t.tone === 'success' ? CircleCheck : Info;
        return (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon size={20} strokeWidth={2} className="toast-icon" />
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const { online } = useStore();
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = read('sheaf-theme');
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  });
  const [backdrop, setBackdrop] = useState<Backdrop>(() => {
    const saved = read('sheaf-backdrop') as Backdrop | null;
    return saved && BACKDROPS.includes(saved) ? saved : 'blue';
  });

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    write('sheaf-theme', theme === 'auto' ? null : theme);
  }, [theme]);
  useEffect(() => {
    document.body.dataset.backdrop = backdrop;
    write('sheaf-backdrop', backdrop);
  }, [backdrop]);
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <NavToggle.Provider value={() => setNavOpen((o) => !o)}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="header">
        <Link to="/" className="logo" aria-label="Sheaf, all tools">
          <Logo />
          <span>Sheaf</span>
        </Link>
        <NavLink to="/" end className="header-item">
          All tools
        </NavLink>
        <span className="header-space" />
        <HeaderSearch />
        <button className="header-icon" aria-label="Settings" title="Settings" onClick={() => setSettings(true)}>
          <Settings size={20} strokeWidth={2} />
        </button>
      </header>
      <div className="window">
        <Navigation open={navOpen} onClose={() => setNavOpen(false)} onSettings={() => setSettings(true)} />
        <div className="main" id="main">
          {online === false && (
            <div className="banner" role="alert">
              <WifiOff size={18} strokeWidth={2} />
              The Sheaf server isn&rsquo;t answering. Tools that work in the browser still run; the rest need it back.
            </div>
          )}
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/:toolId" element={<ToolPage />} />
          </Routes>
        </div>
      </div>
      <Toasts />
      {settings && (
        <SettingsDialog theme={theme} setTheme={setTheme} backdrop={backdrop} setBackdrop={setBackdrop} onClose={() => setSettings(false)} />
      )}
    </NavToggle.Provider>
  );
}
