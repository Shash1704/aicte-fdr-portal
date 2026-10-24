import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, DEMO, getToken, setToken, setUnauthorizedHandler } from './api';
import type { Meta, User } from './types';

// ---------------- Auth ----------------
interface AuthCtx { user: User | null; ready: boolean; login: (u: string, p: string) => Promise<void>; logout: () => void }
const AuthContext = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  const logout = useCallback(() => { setToken(null); setUser(null); qc.clear(); }, [qc]);
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) { setReady(true); return; }
    api<User>('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, [logout]);
  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { body: { username, password } });
    setToken(r.token);
    setUser(await api<User>('/auth/me'));
  }, []);
  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export const isStaff = (u?: User | null) => !!u && u.role !== 'institution';
export const canAct = (u?: User | null) => !!u && ['officer', 'head', 'admin'].includes(u.role);

// ---------------- Reference data ----------------
export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta'), staleTime: Infinity });
}
export function useLookups() {
  const { data } = useMeta();
  return useMemo(() => ({
    meta: data,
    purposeName: (c?: string | null) => data?.purposes.find((p) => p.code === c)?.name ?? c ?? '—',
    typeName: (c?: string | null) => data?.types.find((t) => t.code === c)?.name ?? c ?? '—',
    bankName: (c?: string | null) => (c ? data?.banks.find((b) => b.code === c)?.name ?? c : 'AICTE account (online)'),
    regionName: (c?: string | null) => { const r = data?.regions.find((x) => x.code === c); return r ? `${r.name} (${r.office})` : c ?? '—'; },
    docName: (c?: string | null) => data?.docKinds.find((k) => k.code === c)?.name ?? c ?? '—',
    eventLabel: (c: string) => data?.eventLabels[c] ?? c,
    reasonName: (c?: string | null) => data?.releaseReasons.find((r) => r.code === c)?.name ?? c ?? '—',
  }), [data]);
}

/** The system date. It can run ahead of the real date when the demo time machine is used. */
export function useClock() {
  const { data } = useQuery({ queryKey: ['clock'], queryFn: () => api<{ today: string; offset: number }>('/clock'), staleTime: 60_000 });
  return data ?? { today: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10), offset: 0 };
}

// ---------------- Toasts ----------------
export interface Toast { id: number; title: string; body?: string; tone?: 'info' | 'good' | 'warning' | 'critical'; href?: string }
const ToastContext = createContext<{ push: (t: Omit<Toast, 'id'>) => void; toasts: Toast[]; dismiss: (id: number) => void }>(null as never);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = idRef.current++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), 6000);
  }, [dismiss]);
  return <ToastContext.Provider value={{ push, toasts, dismiss }}>{children}</ToastContext.Provider>;
}

// ---------------- Live updates (SSE) ----------------
export interface LiveEvent { type: string; instrument_id?: number; ref_no?: string; status?: string; by?: string; institution?: string; req_no?: string; at: string; offset?: number; today?: string; reminders?: number; matured?: number; escalated?: number; bankAlerts?: number }
const LiveContext = createContext<{ connected: boolean; events: LiveEvent[]; lastAt: string | null }>({ connected: false, events: [], lastAt: null });
export const useLive = () => useContext(LiveContext);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { push } = useToast();
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const staff = user.role !== 'institution';
    const onUpdate = (evt: LiveEvent) => {
      setLastAt(evt.at);
      setEvents((all) => [evt, ...all].slice(0, 30));
      if (pending.current) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => { qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'meta' }); }, 350);
      if (evt.type === 'instrument.submitted' && staff) push({ tone: 'info', title: `New submission ${evt.ref_no}`, body: evt.institution, href: `/instruments/${evt.instrument_id}` });
      if (evt.type === 'instrument.verified' && !staff) push({ tone: 'good', title: `${evt.ref_no} accepted by AICTE`, href: `/instruments/${evt.instrument_id}` });
      if (evt.type === 'clock') push({ tone: 'info', title: evt.offset ? `System date moved to ${evt.today} (+${evt.offset} days)` : `System date back to ${evt.today}`, body: [evt.reminders && `${evt.reminders} reminders sent`, evt.matured && `${evt.matured} matured`, evt.escalated && `${evt.escalated} escalations`, evt.bankAlerts && `${evt.bankAlerts} bank alerts`].filter(Boolean).join(' · ') || undefined });
      if (evt.type === 'sweep' && evt.bankAlerts && staff) push({ tone: 'critical', title: 'Bank reported an encashed deposit', body: 'Found by the periodic re-check. See Alerts.', href: '/alerts' });
    };
    if (DEMO) {
      let stop: (() => void) | null = null;
      let cancelled = false;
      import('../demo/server.js').then(({ subscribeLive }) => subscribeLive((e) => onUpdate(e as unknown as LiveEvent))).then((sub) => {
        if (cancelled) return sub.unsubscribe();
        stop = sub.unsubscribe;
        setConnected(true);
      });
      return () => { cancelled = true; stop?.(); setConnected(false); };
    }
    let es: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      es = new EventSource(`/api/events?token=${encodeURIComponent(getToken() || '')}`);
      es.addEventListener('hello', () => setConnected(true));
      es.addEventListener('update', (e) => onUpdate(JSON.parse((e as MessageEvent).data) as LiveEvent));
      es.onerror = () => { setConnected(false); es?.close(); retry = window.setTimeout(connect, 5000); };
    };
    connect();
    return () => { es?.close(); window.clearTimeout(retry); setConnected(false); };
  }, [user, qc, push]);

  return <LiveContext.Provider value={{ connected, events, lastAt }}>{children}</LiveContext.Provider>;
}

// ---------------- Theme ----------------
export type ThemeChoice = 'light' | 'dark' | 'system';
const THEME_KEY = 'fdr.theme.v1';
const resolveTheme = (t: ThemeChoice) => (t === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t);

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    try { return (localStorage.getItem(THEME_KEY) as ThemeChoice | null) ?? 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    const apply = () => document.documentElement.setAttribute('data-theme', resolveTheme(theme));
    apply();
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return { theme, setTheme: setThemeState };
}
