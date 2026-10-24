import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, CalendarClock, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Hourglass, Landmark, List,
  MailCheck, MessageSquareReply, RefreshCw, ShieldAlert, ShieldCheck, Undo2, Wallet,
} from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/context';
import { fmtDate, inrShort, num, relTime } from '../lib/format';
import { BarsChart } from '../components/charts';
import { BankBadge, ErrorBox, Spinner, ValidityBadge } from '../components/ui';
import { Compare, pillLink, useParamsState } from '../components/kit';
import type { InstrumentRow } from '../lib/types';

export interface Kpis {
  turnaround: { portal: number | null; legacy: number | null; portalCount: number; legacyCount: number; withinSlaPct: number | null; slaDays: number };
  renewals: { portalOnTimePct: number | null; legacyOnTimePct: number | null; count: number };
  bankConfirmed: { pct: number | null; apiPct: number | null; held: number };
  discrepancies: { byRule: Array<{ rule: string; n: number; amount: number }>; atRiskCount: number; atRiskAmount: number };
  automation: { notices: number; last30: number; reminders: number; hoursSaved: number };
}
interface MonthRow { month: string; renewal_due: number; renewal_in: number; release_eligible: number; amount: number; due_amount: number; in_amount: number; rel_amount: number }
export interface DashboardData {
  today: string;
  region: string | null;
  categories: Record<'active' | 'expiring' | 'expiring_unrenewed' | 'matured' | 'lapsed' | 'renewed' | 'released' | 'pending' | 'queries' | 'release_requested' | 'held_amount' | 'held_count' | 'lapsed_amount' | 'expiring_amount', number>;
  openIssues: Array<{ severity: string; n: number }>;
  maturityProfile: MonthRow[];
  byRegion: Array<{ code: string; name: string; n: number; amount: number; lapsed: number }>;
  byBank: Array<{ bank_code: string | null; name: string; n: number; amount: number; api: boolean | null }>;
  pendingAge: { a: number; b: number; c: number; d: number };
  attention: InstrumentRow[];
  recent: Array<{ id: number; at: string; type: string; remarks: string | null; instrument_id: number; ref_no: string; institution_name: string; actor_name: string | null }>;
  weekly: Array<{ start: string; end: string; submitted: number; verified: number }>;
  trend: Array<{ month: string; verified: number; amount: number }>;
  kpis: Kpis;
}

export const RULE_LABEL: Record<string, string> = {
  BANK_MISMATCH: 'Bank record differs', BANK_NOT_FOUND: 'Not found at bank', BANK_ENCASHED: 'Encashed at bank', BANK_NO_LIEN: 'No lien at bank',
  DOC_MISMATCH: 'Form ≠ document', DUPLICATE_INSTRUMENT: 'Duplicate instrument', DUPLICATE_FILE: 'Reused file', LIEN_NOT_AICTE: 'Not in favour of AICTE',
  AMOUNT_SHORT: 'Amount short', TENURE_SHORT: 'Tenure short', TYPE_NOT_ACCEPTED: 'Type not accepted', DATES_INVALID: 'Invalid dates', IFSC_INVALID: 'IFSC problem',
  DEPOSITOR_MISMATCH: 'Depositor mismatch', MISSING_DOC: 'Missing document', DOC_UNREADABLE: 'Unreadable scan',
};

const MON = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const MONYEAR = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAYMON = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });

export default function Dashboard() {
  const { user } = useAuth();
  const { meta } = useLookups();
  const { values, set } = useParamsState(['region']);
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', values.region], queryFn: () => api<DashboardData>(`/dashboard${qs({ region: values.region })}`), refetchInterval: 60000, placeholderData: keepPreviousData,
  });
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Spinner />;
  const c = data.categories;
  const reg = (q: string) => `/instruments?${q}${values.region ? `&region=${values.region}` : ''}`;
  const regionLabel = values.region ? meta?.regions.find((r) => r.code === values.region)?.name ?? values.region : 'All regions';

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {/* header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[34px] leading-none sm:text-[40px]">Deposits</h1>
              <p className="eyebrow mt-2.5 text-ink-3">Live monitoring · {fmtDate(data.today)}</p>
            </div>
            {user?.role !== 'institution' && (
              <label className="relative">
                <span className="sr-only">Region</span>
                <select value={values.region} onChange={(e) => set({ region: e.target.value || undefined })}
                  className="h-12 appearance-none rounded-full bg-hero pl-6 pr-12 text-[13px] font-semibold text-hero-ink focus:outline-none focus:ring-2 focus:ring-accent/60">
                  <option value="">All regions</option>
                  {meta?.regions.map((r) => <option key={r.code} value={r.code}>{r.name} ({r.office})</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-5 top-1/2 size-4 -translate-y-1/2 text-hero-ink" />
              </label>
            )}
          </div>

          {/* hero: maturity outlook + weekly verifications */}
          <section className="hero rounded-[28px] p-5 sm:p-7">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <h2 className="text-[19px]">Maturity outlook</h2>
                <p className="mt-0.5 text-[11px] text-white/50">Next 6 months · {regionLabel} · bubble size = amount maturing</p>
                <BubbleChart rows={data.maturityProfile.slice(0, 6)} region={values.region} />
              </div>
              <WeeklyPanel weekly={data.weekly} region={values.region} />
            </div>
          </section>

          {/* stat cards + tiles */}
          <section className="glass rounded-[28px] p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StackStat to={reg('status=Submitted,Under Scrutiny,Query Raised')} tint="tint-indigo" icon={<Hourglass className="size-4" />} label={'Pending\nverification'} value={num(c.pending)} delta={`${num(c.queries)} queries`} tone="warn" />
              <StackStat to={reg('status=Active&validity=expiring,maturing,renewal_submitted')} tint="tint-olive" icon={<CalendarClock className="size-4" />} label={'Maturing in\n90 days'} value={num(c.expiring)} delta={inrShort(c.expiring_amount)} tone="good" />
              <StackStat to={reg('validity=lapsed')} tint="tint-rose" icon={<AlertTriangle className="size-4" />} label={'Renewal\noverdue'} value={num(c.lapsed)} delta={inrShort(c.lapsed_amount)} tone="bad" />
              <StackStat to={reg('verification=bank&status=Active,Matured,Release Requested')} tint="tint-green" icon={<BadgeCheck className="size-4" />} label={'Bank-\nconfirmed'} value={<>{Math.round(data.kpis.bankConfirmed.pct ?? 0)}<span className="text-[22px]">%</span></>} delta={`of ${num(data.kpis.bankConfirmed.held)}`} tone="good" />
            </div>
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:col-span-2">
                <PillTile to={reg('status=Active,Matured,Release Requested')} icon={<Wallet className="size-[18px]" />} label="Held" value={inrShort(c.held_amount)} />
                <PillTile to={reg('status=Release Requested')} icon={<Undo2 className="size-[18px]" />} label="In release" value={num(c.release_requested)} />
                <PillTile to={reg('status=Renewed')} icon={<RefreshCw className="size-[18px]" />} label="Renewed" value={num(c.renewed)} />
                <PillTile to={reg('status=Released')} icon={<CheckCircle2 className="size-[18px]" />} label="Released" value={num(c.released)} />
              </div>
              <TrendCard trend={data.trend} kpis={data.kpis} />
            </div>
          </section>
        </div>

        <AgendaPanel region={values.region} today={data.today} />
      </div>

      {/* in depth */}
      <div className="space-y-6">
        <div>
          <p className="eyebrow text-ink-3">In depth</p>
          <h2 className="mt-1 text-[22px]">What needs attention, and how the portal is doing</h2>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <NeedsAttention items={data.attention} />
          <Improvements k={data.kpis} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
          <RegionCard data={data} />
          <BankCard data={data} reg={reg} />
          <section className="glass rounded-[24px] p-6">
            <h2 className="text-[16px]">Latest activity</h2>
            <div className="mt-3"><Activity items={data.recent.slice(0, 8)} /></div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------- hero pieces ----------------
const KIND = {
  due: { label: 'Renewal needed', color: '#ee7b7b', key: 'renewal_due' as const, amt: 'due_amount' as const, q: 'validity=expiring' },
  in: { label: 'Renewal received', color: '#9d6cf0', key: 'renewal_in' as const, amt: 'in_amount' as const, q: 'validity=renewal_submitted' },
  rel: { label: 'Holding period over', color: '#f0c062', key: 'release_eligible' as const, amt: 'rel_amount' as const, q: 'validity=maturing,complete' },
};

/** Months across, number of instruments up, bubble area = amount. The largest bubble is highlighted in lime. */
function BubbleChart({ rows, region }: { rows: MonthRow[]; region: string }) {
  const nav = useNavigate();
  const W = 640, H = 300, L = 40, R = 20, T = 18, B = 34;
  const bubbles = rows.flatMap((r, i) => Object.entries(KIND).filter(([, k]) => r[k.key] > 0).map(([kind, k]) => ({ i, month: r.month, kind, k, n: r[k.key], amount: r[k.amt] })));
  const maxN = Math.max(4, ...bubbles.map((b) => b.n));
  const top = Math.ceil(maxN / 4) * 4;
  const maxAmt = Math.max(1, ...bubbles.map((b) => b.amount));
  const biggest = bubbles.reduce<typeof bubbles[number] | null>((a, b) => (!a || b.amount > a.amount ? b : a), null);
  const x = (i: number) => L + ((W - L - R) / rows.length) * (i + 0.5);
  const y = (n: number) => H - B - ((H - T - B) * n) / top;
  const rad = (amt: number, hero: boolean) => (hero ? 50 : 9 + 26 * Math.sqrt(amt / maxAmt));
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const go = (b: typeof bubbles[number]) => nav(`/instruments?status=Active&maturity_from=${b.month}-01&maturity_to=${b.month}-31&${b.k.q}${region ? `&region=${region}` : ''}`);
  // draw small first so the big ones sit on top
  const ordered = [...bubbles].sort((a, b) => (a === biggest ? 1 : b === biggest ? -1 : b.amount - a.amount));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Instruments maturing in the next six months by month and type">
        {ticks.map((t) => (
          <text key={t} x={L - 12} y={y(t) + 4} textAnchor="end" fontSize="11" fill="rgba(255,255,255,0.55)">{t}</text>
        ))}
        {rows.map((r, i) => (
          <g key={r.month}>
            <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.75)">{MON(r.month)}</text>
          </g>
        ))}
        {ordered.map((b) => {
          const hero = b === biggest;
          const off = b.kind === 'in' ? -16 : b.kind === 'rel' ? 16 : 0;
          const cx = Math.min(W - R - rad(b.amount, hero), Math.max(L + rad(b.amount, hero), x(b.i) + (hero ? 0 : off)));
          const cy = Math.max(T + rad(b.amount, hero), Math.min(H - B - rad(b.amount, hero) * 0.4, y(b.n)));
          return (
            <g key={`${b.month}-${b.kind}`} onClick={() => go(b)} style={{ cursor: 'pointer' }}>
              <title>{`${MONYEAR(b.month)} · ${b.k.label}: ${b.n} instrument(s), ${inrShort(b.amount)}`}</title>
              <circle cx={cx} cy={cy} r={rad(b.amount, hero)} fill={hero ? '#d8f06a' : b.k.color} />
              {hero && <>
                <text x={cx} y={cy - 2} textAnchor="middle" fontSize="17" fontWeight="800" fill="#141414">{inrShort(b.amount)}</text>
                <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="#141414">{MONYEAR(b.month)}</text>
              </>}
            </g>
          );
        })}
        {!bubbles.length && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="rgba(255,255,255,0.6)">Nothing matures in the next six months</text>}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-1 text-[11px] text-white/60">
        {Object.values(KIND).map((k) => <span key={k.label} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: k.color }} />{k.label}</span>)}
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#d8f06a]" />Largest month</span>
      </div>
    </div>
  );
}

function WeeklyPanel({ weekly, region }: { weekly: DashboardData['weekly']; region: string }) {
  const max = Math.max(1, ...weekly.map((w) => Math.max(w.verified, w.submitted)));
  const received = weekly.reduce((a, w) => a + w.submitted, 0);
  const verified = weekly.reduce((a, w) => a + w.verified, 0);
  return (
    <div className="flex min-w-0 flex-col">
      <Link to={`/instruments?status=Submitted,Under Scrutiny,Query Raised&sort=age&dir=asc${region ? `&region=${region}` : ''}`} className="flex items-center justify-between gap-3 rounded-[18px] bg-white/[0.09] px-4 py-3 transition hover:bg-white/[0.13]">
        <span className="min-w-0">
          <span className="block text-[17px] font-bold">Weekly intake</span>
          <span className="block truncate text-[11px] text-white/50">From {DAYMON(weekly[0].start)} – {DAYMON(weekly[weekly.length - 1].end)}</span>
        </span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-white"><ShieldCheck className="size-4" /></span>
      </Link>
      <div className="mt-6 flex h-40 items-end justify-between gap-2 px-1">
        {weekly.map((w, i) => {
          const tall = Math.max(w.submitted, w.verified);
          const h = tall ? Math.max(14, (tall / max) * 100) : 8;
          const done = tall ? Math.min(100, (w.verified / tall) * 100) : 0;
          return (
            <div key={w.start} className="flex min-w-0 flex-1 flex-col items-center gap-2" title={`${DAYMON(w.start)} – ${DAYMON(w.end)}: ${w.submitted} received, ${w.verified} verified`}>
              <div className="flex h-32 w-full items-end justify-center">
                <div className="relative w-full max-w-[28px] overflow-hidden rounded-full bg-[#5a5a5a]" style={{ height: `${h}%` }}>
                  <div className="absolute inset-x-0 bottom-0 rounded-full bg-[#d8f06a]" style={{ height: `${done}%` }} />
                </div>
              </div>
              <span className={clsx('text-center text-[10px] leading-tight', i === weekly.length - 1 ? 'font-bold text-white' : 'text-white/60')}>{w.end.slice(8, 10)}<br />{MON(w.end.slice(0, 7))}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-5">
        <div className="flex items-center gap-2.5"><span className="h-8 w-11 shrink-0 rounded-xl bg-[#5a5a5a]" /><span><span className="block text-[10px] text-white/50">Received</span><span className="block text-[15px] font-bold tnum">{received}</span></span></div>
        <div className="flex items-center gap-2.5"><span className="h-8 w-11 shrink-0 rounded-xl bg-[#d8f06a]" /><span><span className="block text-[10px] text-white/50">Verified</span><span className="block text-[15px] font-bold tnum">{verified}</span></span></div>
      </div>
    </div>
  );
}

// ---------------- cards ----------------
function StackStat({ to, tint, icon, label, value, delta, tone }: { to: string; tint: string; icon: ReactNode; label: string; value: ReactNode; delta: string; tone: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="relative pb-5">
      <div className="stack-layer absolute inset-x-0 bottom-0 h-24 rounded-[22px]" aria-hidden />
      <div className="stack-layer-2 absolute inset-x-0 bottom-2.5 h-24 rounded-[22px]" aria-hidden />
    <Link to={to} className={clsx('relative block rounded-[22px] p-4 text-white shadow-[0_10px_24px_-12px_rgba(0,0,0,0.7)] transition hover:-translate-y-0.5 sm:p-5', tint)}>
      <span className="flex size-9 items-center justify-center rounded-full bg-black/80">{icon}</span>
      <div className="mt-8 whitespace-pre-line text-[10.5px] font-semibold uppercase leading-snug tracking-[0.08em] text-white/85">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-[36px] font-light leading-none tnum">{value}</span>
        <span className={clsx('mb-1 text-[11px] font-semibold', tone === 'bad' ? 'text-[#ff9a9a]' : tone === 'warn' ? 'text-[#f6cf7c]' : 'text-[#c9ec7a]')}>{delta}</span>
      </div>
    </Link>
    </div>
  );
}

function PillTile({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value: string }) {
  return (
    <Link to={to} className="tile flex items-center gap-3 rounded-[18px] px-5 py-4 transition hover:bg-surface-3">
      <span className="text-ink-3">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{label}</span>
      <span className="text-[15px] font-bold tnum">{value}</span>
    </Link>
  );
}

/** Instruments accepted per month, drawn as a glowing lime curve. */
function TrendCard({ trend, kpis }: { trend: DashboardData['trend']; kpis: Kpis }) {
  const uid = useId().replace(/:/g, '');
  const W = 320, H = 110;
  const max = Math.max(1, ...trend.map((t) => t.verified));
  const pts = trend.map((t, i) => [(W / (trend.length - 1)) * i, H - 10 - ((H - 26) * t.verified) / max] as const);
  const line = useMemo(() => smooth(pts), [pts]);
  const onTrack = (kpis.turnaround.withinSlaPct ?? 0) >= 90;
  return (
    <Link to="/reports?name=pending-verification" className="tile relative flex min-h-[150px] flex-col overflow-hidden rounded-[22px] p-4 transition hover:bg-surface-3">
      <div className="flex items-start justify-between gap-2">
        <span>
          <span className="block text-[13px] font-semibold">Accepted per month</span>
          <span className="block text-[11px] text-ink-3">Median verification {kpis.turnaround.portal ?? '—'} days</span>
        </span>
        <span className={clsx('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold', onTrack ? 'bg-accent text-accent-ink' : 'bg-warning text-black')}>{onTrack ? 'On track' : 'Behind'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[62%] w-full" aria-hidden>
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d8f06a" stopOpacity="0.45" /><stop offset="100%" stopColor="#d8f06a" stopOpacity="0" /></linearGradient>
          <filter id={`glow-${uid}`} x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill={`url(#fill-${uid})`} />
        <path d={line} fill="none" stroke="#d8f06a" strokeWidth="5" opacity="0.55" filter={`url(#glow-${uid})`} />
        <path d={line} fill="none" stroke="#e6fa86" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </Link>
  );
}

function smooth(pts: ReadonlyArray<readonly [number, number]>) {
  if (!pts.length) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C ${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6}, ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6}, ${x2} ${y2}`;
  }
  return d;
}

// ---------------- agenda (right panel) ----------------
interface AgendaItem { date: string; kind: string; title: string; subtitle: string; instrument_id: number; amount?: number }
const AGENDA_ICON: Record<string, { icon: ReactNode; bg: string }> = {
  renewal_due: { icon: <CalendarClock className="size-4" />, bg: '#ee7b7b' },
  renewal_in: { icon: <RefreshCw className="size-4" />, bg: '#9d6cf0' },
  release_eligible: { icon: <Undo2 className="size-4" />, bg: '#f0c062' },
  query: { icon: <MessageSquareReply className="size-4" />, bg: '#5ec8d8' },
  verify: { icon: <ShieldCheck className="size-4" />, bg: '#7bc47f' },
};

function AgendaPanel({ region, today }: { region: string; today: string }) {
  const [week, setWeek] = useState(0);
  const [mode, setMode] = useState<'list' | 'compact'>('list');
  const from = addDaysIso(today, week * 7);
  const { data } = useQuery({
    queryKey: ['agenda', region, from], placeholderData: keepPreviousData,
    queryFn: () => api<{ today: string; from: string; to: string; items: AgendaItem[] }>(`/agenda${qs({ region, from, days: 10 })}`),
  });
  const days = Array.from({ length: 10 }, (_, i) => addDaysIso(from, i));
  const byDay = new Map<string, AgendaItem[]>();
  for (const it of data?.items ?? []) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
  const label = week === 0 ? `Today, ${DAYMON(today)}` : `${DAYMON(from)} – ${DAYMON(days[9])}`;
  return (
    <aside className="glass flex min-h-[560px] min-w-0 flex-col rounded-[28px] p-5 xl:sticky xl:top-24 xl:max-h-[calc(100vh-150px)]" aria-label="Agenda">
      <div className="flex items-center gap-2">
        <div className="flex rounded-full bg-surface-2 p-1">
          <button onClick={() => setMode('list')} className={clsx('flex size-8 items-center justify-center rounded-full', mode === 'list' ? 'bg-accent text-accent-ink' : 'text-ink-3')} aria-label="Detailed list"><List className="size-4" /></button>
          <button onClick={() => setMode('compact')} className={clsx('flex size-8 items-center justify-center rounded-full', mode === 'compact' ? 'bg-accent text-accent-ink' : 'text-ink-3')} aria-label="Compact list"><CalendarDays className="size-4" /></button>
        </div>
        <button onClick={() => setWeek((w) => w - 1)} className="ml-2 flex size-8 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2" aria-label="Previous week"><ChevronLeft className="size-4" /></button>
        <button onClick={() => setWeek((w) => w + 1)} className="flex size-8 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2" aria-label="Next week"><ChevronRight className="size-4" /></button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{label}</span>
        {week !== 0 && <button onClick={() => setWeek(0)} className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-ink-2">Today</button>}
      </div>
      <div className="-mr-2 mt-5 flex-1 overflow-y-auto pr-2">
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const isToday = d === today;
          return (
            <div key={d} className="relative">
              <div className="flex items-center gap-3 py-2">
                {isToday
                  ? <span className="relative rounded-md bg-accent px-2 py-0.5 text-[10.5px] font-bold text-accent-ink after:absolute after:left-full after:top-1/2 after:-translate-y-1/2 after:border-y-[6px] after:border-l-[6px] after:border-y-transparent after:border-l-[var(--accent)]">Today</span>
                  : <span className="shrink-0 whitespace-nowrap text-[10.5px] text-ink-3">{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })}</span>}
                <span className={clsx('h-px flex-1', isToday ? 'bg-accent/70' : 'bg-[var(--hairline)]')} />
              </div>
              <ul className="space-y-2 pb-2 pl-3">
                {items.slice(0, mode === 'compact' ? 2 : 6).map((it, k) => {
                  const m = AGENDA_ICON[it.kind] ?? AGENDA_ICON.verify;
                  return (
                    <li key={`${it.instrument_id}-${it.kind}-${k}`}>
                      <Link to={`/instruments/${it.instrument_id}`} className="flex items-center gap-3 rounded-[20px] bg-tile px-3.5 py-3 transition hover:bg-surface-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#141414]" style={{ background: m.bg }}>{m.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{it.title}</span>
                          {mode === 'list' && <span className="block truncate text-[11px] text-ink-3">{it.subtitle}</span>}
                        </span>
                        {it.amount ? <span className="shrink-0 text-[11px] font-semibold text-ink-2 tnum">{inrShort(it.amount)}</span> : null}
                      </Link>
                    </li>
                  );
                })}
                {items.length > (mode === 'compact' ? 2 : 6) && <li className="pl-2 text-[11px] text-ink-3">+{items.length - (mode === 'compact' ? 2 : 6)} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
      <Link to="/calendar" className="mt-3 flex items-center justify-center gap-1.5 rounded-full bg-surface-2 py-2.5 xl:mr-16 text-[12px] font-semibold text-ink-2 hover:bg-surface-3">Open maturity calendar <ArrowUpRight className="size-3.5" /></Link>
    </aside>
  );
}

function addDaysIso(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
}

// ---------------- in-depth section ----------------
function NeedsAttention({ items }: { items: InstrumentRow[] }) {
  return (
    <section className="glass flex min-w-0 flex-col rounded-[24px] p-6">
      <h2 className="text-[16px]">Needs attention</h2>
      <p className="text-xs text-ink-3">Bank alerts, lapsed deposits and critical discrepancies first</p>
      <ul className="mt-4 grid flex-1 gap-2 sm:grid-cols-2">
        {items.slice(0, 8).map((x) => (
          <li key={x.id}>
            <Link to={`/instruments/${x.id}`} className="flex items-center gap-3 rounded-[18px] bg-tile px-3.5 py-3 transition hover:bg-surface-3">
              <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-full', ['encashed', 'not_found'].includes(x.bank_status) || x.validity === 'lapsed' ? 'bg-critical-soft text-critical-text' : 'bg-warning-soft text-warning-text')}>
                {['encashed', 'not_found'].includes(x.bank_status) && x.validity !== 'pending' ? <Landmark className="size-4" /> : x.validity === 'lapsed' ? <AlertTriangle className="size-4" /> : x.validity === 'pending' ? <ShieldAlert className="size-4" /> : <Clock className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold" title={x.institution_name}>{x.institution_name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {['encashed', 'not_found', 'mismatch'].includes(x.bank_status) ? <BankBadge status={x.bank_status} /> : <ValidityBadge state={x.validity} daysLeft={x.days_left} />}
                  <span className="truncate text-[11px] text-ink-3">{x.ref_no} · {inrShort(x.amount)}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
        {!items.length && <li className="py-6 text-center text-sm text-ink-3">Nothing needs attention.</li>}
      </ul>
      <Link to="/reports?name=intervention" className={clsx(pillLink, 'mt-4 self-start')}>All cases requiring intervention <ArrowUpRight className="size-3.5" /></Link>
    </section>
  );
}

function RegionCard({ data }: { data: DashboardData }) {
  const nav = useNavigate();
  return (
    <section className="glass rounded-[24px] p-6">
      <h2 className="text-[16px]">Holdings by region</h2>
      <p className="mb-3 text-xs text-ink-3">Amount held (₹ lakh) · click a bar to open the register</p>
      <BarsChart horizontal height={250} data={data.byRegion.map((r) => ({ ...r, lakh: Math.round(r.amount / 1e5) }))} x="code" valueSuffix=" L"
        onClick={(row) => nav(`/instruments?region=${row.code}&status=Active,Matured,Release Requested`)}
        series={[{ key: 'lakh', name: 'Held (₹ lakh)', color: 'var(--b1)' }]} />
    </section>
  );
}

function BankCard({ data, reg }: { data: DashboardData; reg: (q: string) => string }) {
  return (
    <section className="glass rounded-[24px] p-6">
      <h2 className="text-[16px]">Bank-wise exposure</h2>
      <p className="mb-3 text-xs text-ink-3">Where deposits sit and whether the bank can be checked online</p>
      <ul className="space-y-1.5">
        {data.byBank.slice(0, 8).map((b) => (
          <li key={b.bank_code ?? 'sd'}>
            <Link to={reg(`bank=${b.bank_code ?? ''}&status=Active,Matured,Release Requested`)} className="flex items-center gap-3 rounded-[14px] px-3 py-2 hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">{b.name}</span>
              <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-bold', b.api === null ? 'bg-surface-2 text-ink-3' : b.api ? 'bg-accent-soft text-accent-text' : 'bg-warning-soft text-warning-text')}>{b.api === null ? 'Accounts' : b.api ? 'Online' : 'Letter'}</span>
              <span className="w-16 text-right text-[13px] font-semibold tnum">{inrShort(b.amount)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Improvements({ k }: { k: Kpis }) {
  return (
    <section className="glass space-y-5 rounded-[24px] p-6">
      <div>
        <h2 className="text-[16px]">Portal vs manual register</h2>
        <p className="text-xs text-ink-3">Computed live from the records; “manual” are migrated pre-portal records</p>
      </div>
      <Compare label="Verification turnaround (median)" portal={k.turnaround.portal} legacy={k.turnaround.legacy} unit=" d" better="lower"
        note={`${k.turnaround.withinSlaPct ?? '—'}% verified within ${k.turnaround.slaDays} days`} />
      <Compare label="Renewals received before maturity" portal={k.renewals.portalOnTimePct} legacy={k.renewals.legacyOnTimePct} unit="%" better="higher" />
      <div className="grid grid-cols-2 gap-3">
        <Stat icon={<BadgeCheck className="size-4" />} value={`${k.bankConfirmed.pct ?? '—'}%`} label="held deposits bank-confirmed" />
        <Stat icon={<MailCheck className="size-4" />} value={num(k.automation.notices)} label={`notices sent automatically (≈${num(k.automation.hoursSaved)} staff-hours)`} />
        <Stat icon={<ShieldAlert className="size-4" />} value={num(k.discrepancies.atRiskCount)} label="instruments stopped by critical checks (12 months)" />
        <Stat icon={<Landmark className="size-4" />} value={inrShort(k.discrepancies.atRiskAmount)} label="amount at risk caught" />
      </div>
      {!!k.discrepancies.byRule.length && (
        <div>
          <div className="mb-1.5 text-xs text-ink-2">Problems caught, last 12 months</div>
          <ul className="space-y-1">
            {k.discrepancies.byRule.slice(0, 6).map((r) => (
              <li key={r.rule} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 truncate text-ink-3">{RULE_LABEL[r.rule] ?? r.rule}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-serious" style={{ width: `${(r.n / k.discrepancies.byRule[0].n) * 100}%` }} /></span>
                <span className="w-6 text-right tnum">{r.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="tile rounded-[16px] p-3.5">
      <div className="flex items-center gap-1.5 text-ink-3">{icon}</div>
      <div className="mt-1 text-lg font-bold leading-tight tnum">{value}</div>
      <div className="text-[11px] leading-snug text-ink-3">{label}</div>
    </div>
  );
}

export function Activity({ items }: { items: DashboardData['recent'] }) {
  const { eventLabel } = useLookups();
  return (
    <ul className="space-y-0.5">
      {items.map((e) => (
        <li key={e.id}>
          <Link to={`/instruments/${e.instrument_id}`} className="-mx-2 block rounded-[12px] px-2 py-2 hover:bg-surface-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-ink">{eventLabel(e.type)}</span>
              <span className="shrink-0 text-ink-3">{relTime(e.at)}</span>
            </div>
            <div className="truncate text-xs text-ink-3">{e.ref_no} · {e.institution_name}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
