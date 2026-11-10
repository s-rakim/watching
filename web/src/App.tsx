import { CircleAlert, CircleCheck, Info, Monitor, Moon, Sun, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './lib/store';
import Home from './pages/Home';
import ToolPage from './pages/ToolPage';
import { CATEGORIES, TOOLS } from './tools';

type Theme = 'auto' | 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('sheaf-theme');
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'auto') localStorage.removeItem('sheaf-theme');
      else localStorage.setItem('sheaf-theme', theme);
    } catch {
      // private mode, nothing to save
    }
  }, [theme]);
  const cycle = () => setTheme((t) => (t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'));
  return [theme, cycle];
}

export function Logo() {
  return (
    <svg className="logo-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="6" y="20" width="34" height="38" rx="9" fill="var(--cat-convert-from-fill)" transform="rotate(-12 23 39)" />
      <rect x="16" y="13" width="34" height="38" rx="9" fill="var(--cat-convert-to-fill)" transform="rotate(-2 33 32)" />
      <rect x="25" y="7" width="34" height="38" rx="9" fill="var(--cat-organize-fill)" transform="rotate(9 42 26)" />
    </svg>
  );
}

function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="tools-menu" ref={ref}>
      <button className="btn btn-ghost" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        All tools
      </button>
      {open && (
        <div className="mega" role="menu">
          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="mega-group" data-category={cat.id}>
              <div className="mega-title">
                <span className="dot" />
                {cat.name}
              </div>
              {TOOLS.filter((t) => t.category === cat.id).map((t) => (
                <Link key={t.id} to={`/${t.id}`} className="mega-link" role="menuitem">
                  <t.icon size={16} strokeWidth={2} />
                  {t.name}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Header() {
  const [theme, cycle] = useTheme();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const ThemeIcon = theme === 'auto' ? Monitor : theme === 'light' ? Sun : Moon;
  const label = theme === 'auto' ? 'Theme: follows your system' : theme === 'light' ? 'Theme: light' : 'Theme: dark';
  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="container header-inner">
        <Link to="/" className="logo" aria-label="Sheaf, all tools">
          <Logo />
          <span>Sheaf</span>
        </Link>
        <nav className="header-nav">
          <ToolsMenu />
          <button className="icon-btn" onClick={cycle} aria-label={label} title={label}>
            <ThemeIcon size={20} strokeWidth={2} />
          </button>
        </nav>
      </div>
    </header>
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
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
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
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
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
      <footer className="site-footer">
        <div className="container">
          <span>Sheaf runs on this machine. Your files are never sent anywhere else.</span>
        </div>
      </footer>
      <Toasts />
    </>
  );
}
