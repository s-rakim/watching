import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchHealth, Health } from './api';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface Store {
  health: Health | null;
  /** null while still checking, false when the server can't be reached. */
  online: boolean | null;
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
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

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetchHealth().then((h) => {
        if (!alive) return;
        setHealth(h);
        setOnline(!!h);
      });
    void check();
    const timer = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<Store['toast']>(
    (text, tone = 'info', action) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, text, tone, action }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ health, online, toasts, toast, dismiss }), [health, online, toasts, toast, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider is missing');
  return s;
}
