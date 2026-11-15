import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchHealth, Health } from './api';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
  /** Stays up until dismissed instead of fading after a few seconds. */
  sticky?: boolean;
}

interface Store {
  health: Health | null;
  /** null while still checking, false when the server can't be reached. */
  online: boolean | null;
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action'], sticky?: boolean) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<Store | null>(null);

// Files handed from one tool's result straight into another tool.
let handoff: { tool: string; files: File[] } | null = null;
export function passFiles(tool: string, files: File[]) {
  handoff = { tool, files };
}
export function takeFiles(tool: string): File[] | null {
  if (handoff?.tool !== tool) return null;
  const files = handoff.files;
  handoff = null;
  return files;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<Store['toast']>(
    (text, tone = 'info', action, sticky = false) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, text, tone, action, sticky }]);
      if (!sticky) setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  useEffect(() => {
    let alive = true;
    // The build this tab loaded with. When the server reports a different one, the image
    // was updated, so offer a reload. Never reload on our own: someone may be mid-edit.
    let loaded: string | undefined;
    let told = false;
    const check = () =>
      fetchHealth().then((h) => {
        if (!alive) return;
        setHealth(h);
        setOnline(!!h);
        if (!h?.build) return;
        loaded ??= h.build;
        if (h.build !== loaded && !told) {
          told = true;
          toast('Sheaf-D was updated on the server.', 'info', { label: 'Reload', run: () => location.reload() }, true);
        }
      });
    void check();
    const timer = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [toast]);

  const value = useMemo(() => ({ health, online, toasts, toast, dismiss }), [health, online, toasts, toast, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider is missing');
  return s;
}
