import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3, Bell, Building2, CalendarClock, ClipboardList, FileStack, LayoutGrid, LogOut, Menu, Monitor, Moon, Plus, Search, ShieldCheck, Sun, Undo2, X,
} from 'lucide-react';
import { api, DEMO, qs } from '../lib/api';
import { useAuth, useClock, useLive, useLookups, useTheme, useToast } from '../lib/context';
import { fmtDate, inrShort, relTime } from '../lib/format';
import type { Alert, InstrumentRow } from '../lib/types';
import { StatusBadge, severityIcon } from './ui';

/** Lime mark: two slanted strokes and a dot (an abstract "deposit slip"). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={clsx('size-10 shrink-0', className)} aria-hidden>
      <path d="M8 31 19 13M18 31 29 13" stroke="var(--accent)" strokeWidth="5.5" strokeLinecap="round" />
      <circle cx="31.5" cy="9" r="3.4" fill="var(--accent)" />
    </svg>
  );
}

const initials = (name?: string) => (name ?? '').replace(/^(Prof\.|Dr\.|Shri|Smt\.|Ms\.)\s*/, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function Layout() {
  const { user } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => { setDrawer(false); document.getElementById('main-scroll')?.scrollTo({ top: 0 }); }, [loc.pathname]);
  const { data: alertSummary } = useQuery({ queryKey: ['alerts-summary'], queryFn: () => api<{ unread: number; critical: number; latest: Alert[] }>('/alerts/summary'), refetchInterval: 60000 });
  const staff = user?.role !== 'institution';
  const canSubmit = ['institution', 'officer', 'head', 'admin'].includes(user?.role ?? '');
  const { data: pendingCount } = useQuery({ queryKey: ['instruments', 'pending-count'], enabled: staff, queryFn: () => api<{ total: number }>('/instruments?status=Submitted,Under Scrutiny&size=5').then((r) => r.total) });
  const { data: releaseCount } = useQuery({ queryKey: ['releases', 'mine-count'], queryFn: () => api<unknown[]>('/releases?status=mine').then((r) => r.length) });

  const items: NavLeaf[] = staff ? [
    { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
    { to: '/desk', label: 'My desk', icon: ClipboardList, badge: pendingCount },
    { to: '/instruments', label: 'Register', icon: FileStack },
    { to: '/calendar', label: 'Maturity calendar', icon: CalendarClock },
    { to: '/releases', label: 'Releases', icon: Undo2, badge: releaseCount },
    { to: '/institutions', label: 'Institutions', icon: Building2 },
    { to: '/alerts', label: 'Alerts', icon: Bell, badge: alertSummary?.unread },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
    ...(['admin', 'head', 'auditor'].includes(user?.role ?? '') ? [{ to: '/admin', label: 'Administration', icon: ShieldCheck }] : []),
  ] : [
    { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
    { to: '/instruments', label: 'My deposits', icon: FileStack },
    { to: '/releases', label: 'Release requests', icon: Undo2, badge: releaseCount },
    { to: '/alerts', label: 'Notifications', icon: Bell, badge: alertSummary?.unread },
  ];

  return (
    <div className="min-h-screen bg-main lg:bg-transparent lg:p-5 xl:p-7">
      <div id="app-shell" className="lg:flex lg:h-[calc(100vh-40px)] lg:overflow-hidden lg:rounded-[28px] lg:bg-sidebar lg:shadow-[var(--shell-shadow)] xl:h-[calc(100vh-56px)]">
        <aside className="no-print hidden w-[84px] shrink-0 lg:block"><Rail items={items} /></aside>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal>
            <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[272px] bg-sidebar shadow-2xl"><Drawer items={items} onClose={() => setDrawer(false)} /></div>
          </div>
        )}
        <div id="main-scroll" className="relative flex min-h-screen min-w-0 flex-1 flex-col bg-main lg:min-h-0 lg:overflow-y-auto">
          <header className="header-fade no-print sticky top-0 isolate z-30 px-4 pb-2 pt-4 sm:px-8 sm:pt-6">
            <div className="flex items-center gap-2 sm:gap-3">
              <button className={clsx(iconBtn, 'lg:hidden')} onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="size-5" /></button>
              <GlobalSearch />
              <ClockChip />
              <div className="ml-auto flex items-center gap-1.5">
                <LiveIndicator />
                <ThemeToggle />
                <AlertBell summary={alertSummary} />
                <div className="lg:hidden"><UserMenu /></div>
              </div>
            </div>
          </header>
          <main className="print-full w-full flex-1 px-4 pb-10 pt-3 sm:px-8">
            <Outlet />
          </main>
          <footer className="no-print px-6 pb-5 text-center text-[11px] text-muted">
            {DEMO ? 'Live demo running in your browser · ' : 'Demo build · '}synthetic data: all institutions, officials, deposits and bank records are fictional · SIH 2026 · SIH26265 · Team Varangians
          </footer>
        </div>
      </div>
      {canSubmit && (
        <Link to="/submit" aria-label={staff ? 'Record a deposit' : 'Submit an FDR'} title={staff ? 'Record a deposit' : 'Submit an FDR'}
          className="no-print fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_12px_32px_-6px_rgba(216,240,106,0.55)] transition hover:scale-105 lg:bottom-12 lg:right-12">
          <Plus className="size-6" strokeWidth={2.4} />
        </Link>
      )}
      <Toasts />
    </div>
  );
}

type NavLeaf = { to: string; label: string; icon: typeof LayoutGrid; end?: boolean; badge?: number };

/** Icon rail: lime mark on top, icons in the middle (label on hover), account at the bottom. */
function Rail({ items }: { items: NavLeaf[] }) {
  return (
    <div className="flex h-full flex-col items-center pb-6 pt-7">
      <Link to="/" aria-label="AICTE SD/FDR portal home"><LogoMark /></Link>
      <nav aria-label="Main" className="mt-14 flex flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-visible">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label}
            className={({ isActive }) => clsx('group relative flex size-11 items-center justify-center rounded-full transition-colors',
              isActive ? 'bg-white/10 text-white' : 'text-nav-ink hover:bg-white/5 hover:text-white')}>
            {({ isActive }) => (<>
              <n.icon className={clsx('size-[19px]', isActive && 'text-accent')} strokeWidth={isActive ? 2.2 : 1.9} />
              {!!n.badge && <span className="absolute -right-0.5 -top-0.5 min-w-[17px] rounded-full bg-accent px-1 text-center text-[9.5px] font-bold leading-[17px] text-accent-ink tnum">{n.badge > 99 ? '99+' : n.badge}</span>}
              <span className="pointer-events-none fixed left-[92px] z-50 hidden whitespace-nowrap rounded-full bg-[#050505] px-3 py-1.5 text-xs font-medium text-white shadow-lg group-hover:block group-focus-visible:block lg:ml-5 xl:ml-7">{n.label}</span>
            </>)}
          </NavLink>
        ))}
      </nav>
      <UserMenu rail />
    </div>
  );
}

function Drawer({ items, onClose }: { items: NavLeaf[]; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col px-5 pb-6 pt-6 text-white">
      <div className="flex items-center justify-between"><LogoMark /><button className={clsx(iconBtn, 'text-white/70')} onClick={onClose} aria-label="Close menu"><X className="size-5" /></button></div>
      <nav aria-label="Main" className="mt-8 flex-1 space-y-1 overflow-y-auto">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => clsx('flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium', isActive ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
            {({ isActive }) => (<>
              <n.icon className={clsx('size-[18px]', isActive && 'text-accent')} />
              <span className="flex-1">{n.label}</span>
              {!!n.badge && <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-ink tnum">{n.badge}</span>}
            </>)}
          </NavLink>
        ))}
      </nav>
      <div className="eyebrow text-[9.5px] text-white/40">SIH26265 · Team Varangians</div>
    </div>
  );
}

function LiveIndicator() {
  const { connected, lastAt } = useLive();
  return (
    <div className="hidden shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-ink-2 xl:flex" title={connected ? `Receiving real-time updates${lastAt ? ` · last ${relTime(lastAt)}` : ''}` : 'Reconnecting…'}>
      <span className={clsx('size-2 rounded-full', connected ? 'live-dot bg-accent' : 'bg-muted')} />
      {connected ? 'Live' : 'Offline'}
    </div>
  );
}

const iconBtn = 'relative flex size-10 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink';

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return <button className={clsx(iconBtn, 'hidden sm:flex')} onClick={() => setTheme(next)} title={`Theme: ${theme} (click for ${next})`} aria-label="Toggle theme"><Icon className="size-[18px]" /></button>;
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  return { open, setOpen, ref };
}

function AlertBell({ summary }: { summary?: { unread: number; critical: number; latest: Alert[] } }) {
  const { open, setOpen, ref } = usePopover();
  const nav = useNavigate();
  return (
    <div className="relative" ref={ref}>
      <button className={iconBtn} onClick={() => setOpen((o) => !o)} aria-label="Alerts" aria-expanded={open}>
        <Bell className="size-[18px]" />
        {!!summary?.unread && <span className={clsx('absolute right-1 top-1 min-w-[17px] rounded-full px-1 text-center text-[10px] font-bold leading-[17px]', summary.critical ? 'bg-critical text-white' : 'bg-accent text-accent-ink')}>{summary.unread > 99 ? '99+' : summary.unread}</span>}
      </button>
      {open && (
        <div className="glass-pop absolute right-0 top-12 z-40 w-[min(92vw,380px)] overflow-hidden rounded-[24px]">
          <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold">Alerts <span className="text-xs font-normal text-ink-3">{summary?.unread ?? 0} unread</span></div>
          <ul className="max-h-96 space-y-1 overflow-y-auto px-2 pb-2">
            {summary?.latest.map((a) => (
              <li key={a.id}>
                <button className={clsx('flex w-full gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2', !a.read && 'bg-surface-1')}
                  onClick={() => { setOpen(false); api(`/alerts/${a.id}/read`, { method: 'POST' }).catch(() => {}); nav(a.release_id ? `/releases/${a.release_id}` : a.instrument_id ? `/instruments/${a.instrument_id}` : '/alerts'); }}>
                  <span className={clsx('mt-0.5', a.severity === 'critical' ? 'text-critical-text' : a.severity === 'serious' ? 'text-serious-text' : a.severity === 'warning' ? 'text-warning-text' : 'text-info-text')}>{severityIcon(a.severity)}</span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm text-ink">{a.title}</span>
                    <span className="text-xs text-ink-3">{relTime(a.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!summary?.latest.length && <li className="px-4 py-6 text-center text-sm text-ink-3">No active alerts</li>}
          </ul>
          <Link to="/alerts" onClick={() => setOpen(false)} className="block border-t border-hairline px-4 py-3 text-center text-sm font-semibold text-accent-text hover:bg-surface-2">View all alerts</Link>
        </div>
      )}
    </div>
  );
}

function UserMenu({ rail }: { rail?: boolean }) {
  const { user, logout } = useAuth();
  const { regionName, meta } = useLookups();
  const { open, setOpen, ref } = usePopover();
  const scope = user?.role === 'institution' ? `${user.institution?.name} (${user.institution?.aicte_id})` : user?.role === 'officer' ? `Regions: ${(user.regions ?? '').split(',').map((r) => regionName(r)).join(', ')}` : `${meta?.roles[user!.role] ?? ''} · all regions`;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label="Account" aria-expanded={open} title={user?.name}
        className={clsx('flex items-center justify-center rounded-full bg-accent font-bold text-accent-ink ring-2 ring-white/10 transition hover:ring-accent/60', rail ? 'size-11 text-sm' : 'ml-1 size-9 text-xs')}>
        {initials(user?.name)}
      </button>
      {open && (
        <div className={clsx('glass-pop absolute z-50 w-72 rounded-[24px] p-4 text-ink', rail ? 'bottom-0 left-14' : 'right-0 top-12')}>
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-full bg-accent font-bold text-accent-ink">{initials(user?.name)}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{user?.name}</div>
              <div className="truncate text-xs text-ink-3">{user?.designation}</div>
            </div>
          </div>
          <div className="tile mt-3 rounded-xl px-3 py-2 text-xs text-ink-2">Scope: {scope}</div>
          <button onClick={logout} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-surface-2 px-3 py-2 text-sm font-medium hover:bg-surface-3"><LogOut className="size-4" />Sign out</button>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const { data } = useQuery({
    queryKey: ['search', debounced], enabled: debounced.length >= 2,
    queryFn: () => api<{ instruments: InstrumentRow[]; institutions: Array<{ id: number; name: string; aicte_id: string; city: string; state: string }> }>(`/search${qs({ q: debounced })}`),
  });
  const go = (path: string) => { setOpen(false); setQ(''); nav(path); };
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-md" ref={ref}>
      <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={2} />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) go(`/instruments${qs({ q: q.trim() })}`); if (e.key === 'Escape') setOpen(false); }}
        placeholder="Search FDR no., reference, institution, AICTE ID…" aria-label="Search"
        id="global-search" className="h-11 w-full rounded-full border border-transparent bg-panel pl-11 pr-4 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent/60 focus:outline-none" />
      {open && debounced.length >= 2 && data && (
        <div className="glass-pop absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-[24px] p-2">
          {!!data.institutions.length && <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Institutions</div>}
          {data.institutions.map((i) => (
            <button key={i.id} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2" onClick={() => go(`/institutions/${i.id}`)}>
              <Building2 className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{i.name}</span><span className="text-xs text-ink-3">{i.aicte_id} · {i.city}, {i.state}</span></span>
            </button>
          ))}
          {!!data.instruments.length && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Instruments</div>}
          {data.instruments.map((c) => (
            <button key={c.id} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2" onClick={() => go(`/instruments/${c.id}`)}>
              <FileStack className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{c.ref_no} · {c.type} {c.instrument_no}</span><span className="block truncate text-xs text-ink-3">{c.institution_name} · {inrShort(c.amount)}</span></span>
              <StatusBadge status={c.status} />
            </button>
          ))}
          {!data.instruments.length && !data.institutions.length && <div className="px-3 py-3 text-sm text-ink-3">Nothing found</div>}
          <button className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-accent-text hover:bg-surface-2" onClick={() => go(`/instruments${qs({ q: debounced })}`)}>Search the register for “{debounced}” ↵</button>
        </div>
      )}
    </div>
  );
}

/** Shown when the demo time machine has moved the system date ahead of the real date. */
function ClockChip() {
  const { today, offset } = useClock();
  if (!offset) return null;
  return (
    <Link to="/admin#clock" className="hidden shrink-0 items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning-text md:flex" title="The demo time machine is on">
      <CalendarClock className="size-3.5" />System date {fmtDate(today)} (+{offset}d)
    </Link>
  );
}

function Toasts() {
  const { toasts, dismiss } = useToast();
  const nav = useNavigate();
  return (
    <div className="no-print pointer-events-none fixed bottom-5 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={clsx('glass-pop pointer-events-auto rounded-[24px] p-3.5', t.tone === 'warning' && 'ring-1 ring-warning/60', t.tone === 'critical' && 'ring-1 ring-critical/60', t.tone === 'good' && 'ring-1 ring-good/50')}>
          <div className="flex items-start gap-2">
            <button className="min-w-0 flex-1 text-left" onClick={() => { if (t.href) nav(t.href); dismiss(t.id); }}>
              <div className="text-sm font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 text-sm text-ink-2">{t.body}</div>}
            </button>
            <button className="rounded-full p-1 text-ink-3 hover:bg-surface-2" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
