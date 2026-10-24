import type { ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { num, fmtDate, inrShort } from '../lib/format';
import { useLookups } from '../lib/context';
import type { InstrumentRow } from '../lib/types';
import { Button, IssueDot, StatusBadge, ValidityBadge, VerificationBadge, BankBadge } from './ui';

export const pillLink = 'flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-xs font-semibold text-ink-2 hover:bg-surface-3 hover:text-ink';

export function SectionNo({ n, label }: { n: string; label: string }) {
  return <div className="eyebrow flex items-center gap-3 text-ink-3"><span className="text-ink-2">.{n}</span><span className="h-px w-8 bg-[var(--axis)]" />{label}</div>;
}

export function StripKpi({ icon, label, value, sub, to, tone }: { icon: ReactNode; label: string; value: number; sub: string; to: string; tone?: 'accent' | 'critical' | 'warning' }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-[24px] p-3 transition-colors hover:bg-surface-2 sm:p-4">
      <span className={clsx('flex size-11 shrink-0 items-center justify-center rounded-full',
        tone === 'accent' ? 'bg-accent text-accent-ink' : tone === 'critical' ? 'bg-critical-soft text-critical-text' : tone === 'warning' ? 'bg-warning-soft text-warning-text' : 'bg-accent-soft text-accent-text')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-ink-3">{label}</span>
        <span className={clsx('block text-[22px] font-semibold leading-tight tnum', tone === 'critical' && value > 0 && 'text-critical-text')}>{num(value)}</span>
        <span className="block truncate text-[11px] text-ink-3">{sub}</span>
      </span>
    </Link>
  );
}

/** Before/after comparison bar: the portal figure against the manual (pre-portal) baseline. */
export function Compare({ label, portal, legacy, unit, better, note }: { label: string; portal: number | null; legacy: number | null; unit: string; better: 'lower' | 'higher'; note?: string }) {
  const max = Math.max(portal ?? 0, legacy ?? 0, 1);
  const improved = portal !== null && legacy !== null && (better === 'lower' ? portal < legacy : portal > legacy);
  const delta = portal !== null && legacy !== null && legacy !== 0 ? Math.round(better === 'lower' ? ((legacy - portal) / legacy) * 100 : portal - legacy) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-2">{label}</span>
        {delta !== null && improved && <span className="text-[11px] font-medium text-good-text">{better === 'lower' ? `${delta}% faster` : `+${delta} pts`}</span>}
      </div>
      {[['Portal', portal, 'bg-sun'], ['Manual', legacy, 'bg-surface-3']].map(([l, v, cls]) => (
        <div key={l as string} className="mt-1.5 flex items-center gap-2">
          <span className="w-12 shrink-0 text-[10px] uppercase tracking-[0.12em] text-ink-3">{l}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-1"><span className={clsx('block h-full rounded-full', cls)} style={{ width: `${((Number(v) || 0) / max) * 100}%` }} /></span>
          <span className="w-16 shrink-0 text-right text-xs tnum text-ink">{v === null ? '—' : `${v}${unit}`}</span>
        </div>
      ))}
      {note && <div className="mt-1 text-[11px] text-ink-3">{note}</div>}
    </div>
  );
}

export function Th({ k, children, className, current, dir, onSort }: { k?: string; children?: ReactNode; className?: string; current?: string; dir?: string; onSort?: (k: string) => void }) {
  return (
    <th className={clsx('whitespace-nowrap px-2.5 py-2 text-left text-xs font-medium text-ink-3', className)}>
      {k && onSort ? (
        <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => onSort(k)}>
          {children}{current === k && (dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      ) : children}
    </th>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="no-print flex items-center gap-1 text-sm">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
      <span className="tnum text-ink-2">Page {page} of {pages}</span>
      <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
    </div>
  );
}

/** Query-string state for list pages, so filtered views are shareable and survive reloads. */
export function useParamsState(keys: string[]) {
  const [sp, setSp] = useSearchParams();
  const values: Record<string, string> = {};
  for (const k of keys) values[k] = sp.get(k) ?? '';
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  return { values, set };
}

/** The instrument table used by the register, desk and institution pages. */
export function InstrumentTable({ rows, sort, showInstitution = true, compact }: {
  rows: InstrumentRow[]; sort?: { current: string; dir?: string; onSort: (k: string) => void }; showInstitution?: boolean; compact?: boolean;
}) {
  const nav = useNavigate();
  const { purposeName, bankName } = useLookups();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-hairline bg-surface-1">
          <tr>
            <Th k="ref" {...sort}>Reference</Th>
            {showInstitution && <Th k="institution" {...sort}>Institution</Th>}
            <Th>Instrument</Th>
            <Th k="amount" {...sort} className="text-right">Amount</Th>
            <Th k="maturity" {...sort}>Maturity · hold until</Th>
            <Th k="status" {...sort}>Status</Th>
            <Th k="issues" {...sort}>Checks</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer border-b border-hairline align-top last:border-0 hover:bg-surface-2" onClick={() => nav(`/instruments/${r.id}`)}>
              <td className="whitespace-nowrap px-2.5 py-2.5">
                <Link to={`/instruments/${r.id}`} className="font-medium text-accent-text hover:underline" onClick={(e) => e.stopPropagation()}>{r.ref_no}</Link>
                <div className="max-w-40 truncate text-[11px] text-ink-3" title={purposeName(r.purpose)}>{purposeName(r.purpose)}</div>
              </td>
              {showInstitution && (
                <td className="max-w-52 px-2.5 py-2.5">
                  <div className="truncate font-medium" title={r.institution_name}>{r.institution_name}</div>
                  <div className="truncate text-xs text-ink-3">{r.aicte_id} · {r.city}</div>
                </td>
              )}
              <td className="max-w-44 px-2.5 py-2.5">
                <div className="truncate"><span className="text-ink-3">{r.type}</span> <span className="tnum">{r.instrument_no}</span></div>
                <div className="truncate text-xs text-ink-3">{bankName(r.bank_code)}</div>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2.5 text-right tnum">{inrShort(r.amount)}</td>
              <td className="whitespace-nowrap px-2.5 py-2.5">
                <div className="tnum">{r.maturity_date ? fmtDate(r.maturity_date) : <span className="text-ink-3">No maturity</span>}</div>
                <div className="text-[11px] text-ink-3">hold till {fmtDate(r.hold_until)}</div>
              </td>
              <td className="px-2.5 py-2.5">
                <StatusBadge status={r.status} />
                <div className="mt-1"><ValidityBadge state={r.validity} daysLeft={r.days_left} /></div>
              </td>
              <td className="px-2.5 py-2.5">
                <div className="flex flex-wrap items-center gap-1">
                  {['mismatch', 'not_found', 'encashed'].includes(r.bank_status) ? <BankBadge status={r.bank_status} /> : !compact || r.verification !== 'unverified' ? <VerificationBadge mode={r.verification} /> : null}
                  <IssueDot worst={r.worst_issue} count={r.open_issues} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
