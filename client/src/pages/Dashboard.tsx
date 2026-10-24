import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, BadgeCheck, CalendarClock, CheckCircle2, Clock, Hourglass, Landmark, MailCheck, RefreshCw, ShieldAlert, ShieldCheck, Undo2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useLookups } from '../lib/context';
import { fmtDate, inrShort, monthLabel, num, relTime } from '../lib/format';
import { BarsChart } from '../components/charts';
import { ErrorBox, Spinner, ValidityBadge, BankBadge } from '../components/ui';
import { Compare, InkStat, SectionNo, StripKpi, pillLink } from '../components/kit';
import type { InstrumentRow } from '../lib/types';

export interface Kpis {
  turnaround: { portal: number | null; legacy: number | null; portalCount: number; legacyCount: number; withinSlaPct: number | null; slaDays: number };
  renewals: { portalOnTimePct: number | null; legacyOnTimePct: number | null; count: number };
  bankConfirmed: { pct: number | null; apiPct: number | null; held: number };
  discrepancies: { byRule: Array<{ rule: string; n: number; amount: number }>; atRiskCount: number; atRiskAmount: number };
  automation: { notices: number; last30: number; reminders: number; hoursSaved: number };
}
export interface DashboardData {
  today: string;
  categories: Record<'active' | 'expiring' | 'expiring_unrenewed' | 'matured' | 'lapsed' | 'renewed' | 'released' | 'pending' | 'queries' | 'release_requested' | 'held_amount' | 'held_count' | 'lapsed_amount' | 'expiring_amount', number>;
  openIssues: Array<{ severity: string; n: number }>;
  maturityProfile: Array<{ month: string; renewal_due: number; renewal_in: number; release_eligible: number; amount: number }>;
  byRegion: Array<{ code: string; name: string; n: number; amount: number; lapsed: number }>;
  byBank: Array<{ bank_code: string | null; name: string; n: number; amount: number; api: boolean | null }>;
  pendingAge: { a: number; b: number; c: number; d: number };
  attention: InstrumentRow[];
  recent: Array<{ id: number; at: string; type: string; remarks: string | null; instrument_id: number; ref_no: string; institution_name: string; actor_name: string | null }>;
  kpis: Kpis;
}

export const RULE_LABEL: Record<string, string> = {
  BANK_MISMATCH: 'Bank record differs', BANK_NOT_FOUND: 'Not found at bank', BANK_ENCASHED: 'Encashed at bank', BANK_NO_LIEN: 'No lien at bank',
  DOC_MISMATCH: 'Form ≠ document', DUPLICATE_INSTRUMENT: 'Duplicate instrument', DUPLICATE_FILE: 'Reused file', LIEN_NOT_AICTE: 'Not in favour of AICTE',
  AMOUNT_SHORT: 'Amount short', TENURE_SHORT: 'Tenure short', TYPE_NOT_ACCEPTED: 'Type not accepted', DATES_INVALID: 'Invalid dates', IFSC_INVALID: 'IFSC problem',
  DEPOSITOR_MISMATCH: 'Depositor mismatch', MISSING_DOC: 'Missing document', DOC_UNREADABLE: 'Unreadable scan',
};

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard'), refetchInterval: 60000 });
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Spinner />;
  const c = data.categories;
  const critical = data.openIssues.find((i) => i.severity === 'critical')?.n ?? 0;
  const reg = (q: string) => `/instruments?${q}`;
  const first = (user?.name ?? '').replace(/^(Shri|Smt\.|Ms\.|Dr\.|Prof\.)\s*/, '').split(' ')[0];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <SectionNo n="01" label="Today" />
        <div>
          <h1 className="text-[26px] leading-tight sm:text-[30px]">Good {greet()}, {first}</h1>
          <p className="mt-1 text-sm text-ink-3">{fmtDate(data.today)} · {inrShort(c.held_amount)} held in {num(c.held_count)} deposits for AICTE · {num(c.pending)} submissions awaiting verification</p>
        </div>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="glass flex min-w-0 flex-col rounded-[10px] p-5">
            <h2 className="text-[13px]">Needs attention</h2>
            <p className="text-xs text-ink-3">Bank alerts, lapsed deposits and critical discrepancies first</p>
            <ul className="mt-3 flex-1 space-y-1">
              {data.attention.slice(0, 6).map((x) => (
                <li key={x.id}>
                  <Link to={`/instruments/${x.id}`} className="-mx-2 flex items-center gap-3 rounded-[6px] px-2 py-2 transition hover:bg-surface-1">
                    <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full', ['encashed', 'not_found'].includes(x.bank_status) || x.validity === 'lapsed' ? 'bg-critical-soft text-critical-text' : 'bg-warning-soft text-warning-text')}>
                      {['encashed', 'not_found'].includes(x.bank_status) && x.status !== 'Under Scrutiny' ? <Landmark className="size-4" /> : x.validity === 'lapsed' ? <AlertTriangle className="size-4" /> : x.validity === 'pending' ? <ShieldAlert className="size-4" /> : <Clock className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink" title={x.institution_name}>{x.institution_name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {['encashed', 'not_found', 'mismatch'].includes(x.bank_status) ? <BankBadge status={x.bank_status} /> : <ValidityBadge state={x.validity} daysLeft={x.days_left} />}
                        <span className="truncate text-xs text-ink-3">{x.ref_no} · {inrShort(x.amount)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
              {!data.attention.length && <li className="py-6 text-center text-sm text-ink-3">Nothing needs attention.</li>}
            </ul>
            <Link to="/reports?name=intervention" className="eyebrow mt-3 flex items-center justify-center gap-1.5 rounded-[4px] border border-[var(--axis)] py-2.5 text-ink-2 hover:border-ink hover:text-ink">
              All cases requiring intervention <ArrowRight className="size-3.5" />
            </Link>
          </section>
          <div className="space-y-4">
            <InkStat to={reg('status=Active,Matured,Release Requested')} label="Held for AICTE" value={inrShort(c.held_amount)} sub={`${num(c.held_count)} deposits, FDRs and guarantees on record`}
              foot={[['Active', num(c.active + c.expiring)], ['Maturing ≤ 90d', num(c.expiring)], ['Matured', num(c.matured)]]} />
            <InkStat alt to={reg('validity=lapsed')} label="Renewal overdue" value={num(c.lapsed)} sub={`${inrShort(c.lapsed_amount)} no longer secured · ${num(c.expiring_unrenewed)} more due within 90 days`}
              foot={[['Critical issues', num(critical)], ['Queries open', num(c.queries)]]} />
          </div>
        </div>

        <section>
          <div className="glass grid grid-cols-2 gap-1.5 rounded-[10px] p-2 md:grid-cols-4">
            <StripKpi to={reg('status=Submitted,Under Scrutiny,Query Raised')} icon={<Hourglass className="size-5" />} label="Pending verification" value={c.pending} sub={`${num(c.queries)} awaiting institution reply`} tone="accent" />
            <StripKpi to={reg('validity=expiring,maturing,renewal_submitted&status=Active')} icon={<CalendarClock className="size-5" />} label="Expiring in 90 days" value={c.expiring} sub={`${inrShort(c.expiring_amount)} needs renewal`} tone="warning" />
            <StripKpi to={reg('status=Matured')} icon={<AlertTriangle className="size-5" />} label="Matured" value={c.matured} sub={`${num(c.lapsed)} with renewal overdue`} tone="critical" />
            <StripKpi to={reg('status=Release Requested')} icon={<Undo2 className="size-5" />} label="Release requested" value={c.release_requested} sub="in the approval chain" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Mini to={reg('status=Active&validity=valid,complete')} icon={<ShieldCheck className="size-4" />} label="Active" value={c.active} />
            <Mini to={reg('status=Renewed')} icon={<RefreshCw className="size-4" />} label="Renewed" value={c.renewed} />
            <Mini to={reg('status=Released')} icon={<CheckCircle2 className="size-4" />} label="Released" value={c.released} />
            <Mini to={reg('issues=blocking')} icon={<ShieldAlert className="size-4" />} label="Open discrepancies" value={data.openIssues.reduce((s, i) => s + i.n, 0)} />
          </div>
        </section>

        <section className="glass rounded-[10px] p-5">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px]">Maturity profile</h2>
              <p className="text-xs text-ink-3">Active instruments maturing in the next 12 months · click a month to see them</p>
            </div>
            <Link to="/calendar" className={pillLink}>Maturity calendar <ArrowUpRight className="size-3.5" /></Link>
          </div>
          <BarsChart stacked height={250} data={data.maturityProfile} x="month" xFormatter={monthLabel}
            onClick={(row) => { const m = String(row.month); nav(`/instruments?status=Active&maturity_from=${m}-01&maturity_to=${m}-31&sort=maturity&dir=asc`); }}
            series={[
              { key: 'renewal_due', name: 'Renewal needed', color: 'var(--warning)' },
              { key: 'renewal_in', name: 'Renewal submitted', color: 'var(--s1)' },
              { key: 'release_eligible', name: 'Holding period ends', color: 'var(--good)' },
            ]} />
        </section>

        <div className="grid gap-5 2xl:grid-cols-2">
          <section className="glass rounded-[10px] p-5">
            <h2 className="text-[13px]">Holdings by region</h2>
            <p className="mb-3 text-xs text-ink-3">Amount held (₹ lakh) · click a bar to open the register</p>
            <BarsChart horizontal height={260} data={data.byRegion.map((r) => ({ ...r, lakh: Math.round(r.amount / 1e5) }))} x="code" valueSuffix=" L"
              onClick={(row) => nav(reg(`region=${row.code}&status=Active,Matured,Release Requested`))}
              series={[{ key: 'lakh', name: 'Held (₹ lakh)', color: 'var(--b1)' }]} />
          </section>
          <section className="glass rounded-[10px] p-5">
            <h2 className="text-[13px]">Bank-wise exposure</h2>
            <p className="mb-3 text-xs text-ink-3">Where deposits sit and whether the bank can be checked online</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="text-left text-xs text-ink-3"><th className="py-1.5">Bank</th><th className="py-1.5 text-right">Instruments</th><th className="py-1.5 text-right">Amount</th><th className="py-1.5 text-right">Check</th></tr></thead>
                <tbody className="tnum">
                  {data.byBank.slice(0, 9).map((b) => (
                    <tr key={b.bank_code ?? 'sd'} className="border-t border-hairline">
                      <td className="py-1.5"><Link className="hover:underline" to={reg(`bank=${b.bank_code ?? ''}&status=Active,Matured,Release Requested`)}>{b.name}</Link></td>
                      <td className="py-1.5 text-right">{num(b.n)}</td>
                      <td className="py-1.5 text-right">{inrShort(b.amount)}</td>
                      <td className="py-1.5 text-right text-xs">{b.api === null ? <span className="text-ink-3">Accounts</span> : b.api ? <span className="text-good-text">Online</span> : <span className="text-warning-text">Letter</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <aside className="min-w-0 space-y-5 xl:border-l xl:border-hairline xl:pl-6" aria-label="Summary">
        <SectionNo n="02" label="Measured improvement" />
        <Improvements k={data.kpis} />
        <section className="glass rounded-[10px] p-5">
          <h2 className="text-[13px]">Pending verification by age</h2>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {([['0–3 d', data.pendingAge.a], ['4–7 d', data.pendingAge.b], ['8–15 d', data.pendingAge.c], ['> 15 d', data.pendingAge.d]] as const).map(([l, v], k) => (
              <div key={l} className={clsx('rounded-[8px] p-2', k >= 2 && v ? 'bg-warning-soft' : 'tile')}>
                <div className="text-lg font-semibold tnum">{num(v ?? 0)}</div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">{l}</div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[13px]">Latest activity</h2>
          </div>
          <Activity items={data.recent} />
        </section>
      </aside>
    </div>
  );
}

const greet = () => { const h = Number(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false })); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };

function Mini({ to, icon, label, value }: { to: string; icon: React.ReactNode; label: string; value: number }) {
  return (
    <Link to={to} className="glass flex items-center gap-3 rounded-[10px] px-4 py-3 transition hover:-translate-y-0.5">
      <span className="text-ink-3">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{label}</span>
      <span className="text-lg font-semibold tnum">{num(value)}</span>
    </Link>
  );
}

export function Improvements({ k }: { k: Kpis }) {
  return (
    <section className="glass space-y-5 rounded-[10px] p-5">
      <div>
        <h2 className="text-[13px]">Portal vs manual register</h2>
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
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-1"><span className="block h-full rounded-full bg-serious" style={{ width: `${(r.n / k.discrepancies.byRule[0].n) * 100}%` }} /></span>
                <span className="w-6 text-right tnum">{r.n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="tile rounded-[8px] p-3">
      <div className="flex items-center gap-1.5 text-ink-3">{icon}</div>
      <div className="mt-1 text-lg font-semibold leading-tight tnum">{value}</div>
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
          <Link to={`/instruments/${e.instrument_id}`} className="-mx-1 block rounded-[6px] px-1 py-2 hover:bg-surface-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-ink">{eventLabel(e.type)}</span>
              <span className="shrink-0 text-ink-3">{relTime(e.at)}</span>
            </div>
            <div className="truncate text-xs text-ink-3">{e.ref_no} · {e.institution_name}</div>
            {e.remarks && <div className="line-clamp-1 text-[11px] text-ink-3">{e.remarks}</div>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
