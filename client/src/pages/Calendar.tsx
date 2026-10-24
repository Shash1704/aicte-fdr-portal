import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useClock } from '../lib/context';
import { inrShort } from '../lib/format';
import type { InstrumentRow } from '../lib/types';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { InstrumentTable } from '../components/kit';

const ym = (d: string) => d.slice(0, 7);
const shift = (m: string, n: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

export default function Calendar() {
  const { today } = useClock();
  const [month, setMonth] = useState(ym(today));
  const [day, setDay] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['instruments', 'calendar', month],
    queryFn: () => api<{ rows: InstrumentRow[] }>(`/instruments?status=Active,Matured,Release Requested&maturity_from=${month}-01&maturity_to=${month}-31&size=200&sort=maturity&dir=asc`),
  });
  const byDay = new Map<string, InstrumentRow[]>();
  for (const r of data?.rows ?? []) { const k = r.maturity_date!; byDay.set(k, [...(byDay.get(k) ?? []), r]); }
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const lead = (first + 6) % 7; // weeks start on Monday
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const list = day ? byDay.get(day) ?? [] : data?.rows ?? [];
  const needRenewal = (data?.rows ?? []).filter((r) => r.validity === 'expiring' || r.validity === 'lapsed').length;

  return (
    <div>
      <PageHeader title="Maturity calendar" subtitle="When held instruments mature, and which still need a renewal"
        actions={<div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setMonth(shift(month, -1)); setDay(null); }} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
          <span className="w-36 text-center text-sm font-medium">{label}</span>
          <Button size="sm" variant="ghost" onClick={() => { setMonth(shift(month, 1)); setDay(null); }} aria-label="Next month"><ChevronRight className="size-4" /></Button>
          <Button size="sm" onClick={() => { setMonth(ym(today)); setDay(null); }}>Today</Button>
        </div>} />
      <Card bodyClass="p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap gap-4 px-1 text-xs text-ink-3">
          <span>{data?.rows.length ?? '…'} maturities · {inrShort((data?.rows ?? []).reduce((s, r) => s + r.amount, 0))}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning" />renewal needed ({needRenewal})</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: 'var(--s1)' }} />renewal submitted</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-good" />no renewal needed</span>
        </div>
        {!data ? <Spinner /> : (
          <div className="grid grid-cols-7 gap-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="eyebrow px-1 pb-1 text-[9.5px] text-ink-3">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`x${i}`} />;
              const items = byDay.get(d) ?? [];
              const isToday = d === today;
              return (
                <button key={d} onClick={() => setDay(day === d ? null : d)}
                  className={clsx('flex min-h-[74px] flex-col rounded-[6px] p-1.5 text-left transition sm:min-h-[92px]', day === d ? 'bg-surface-3 ring-1 ring-ink' : items.length ? 'bg-surface-1 hover:bg-surface-2' : 'hover:bg-surface-1', d < today && 'opacity-60')}>
                  <span className={clsx('text-xs tnum', isToday ? 'flex size-5 items-center justify-center rounded-full bg-accent font-semibold text-accent-ink' : 'text-ink-3')}>{Number(d.slice(8))}</span>
                  <span className="mt-1 flex flex-wrap gap-0.5">
                    {items.slice(0, 8).map((r) => <span key={r.id} title={`${r.ref_no} · ${r.institution_name}`} className="size-2 rounded-full" style={{ background: r.validity === 'expiring' || r.validity === 'lapsed' ? 'var(--warning)' : r.validity === 'renewal_submitted' ? 'var(--s1)' : 'var(--good)' }} />)}
                  </span>
                  {!!items.length && <span className="mt-auto hidden text-[10px] text-ink-3 sm:block">{items.length} · {inrShort(items.reduce((s, r) => s + r.amount, 0))}</span>}
                </button>
              );
            })}
          </div>
        )}
      </Card>
      <Card className="mt-5" title={day ? `Maturing on ${day.split('-').reverse().join('-')}` : `All maturities in ${label}`} bodyClass="p-0">
        {list.length ? <InstrumentTable rows={list} compact /> : <p className="p-5 text-sm text-ink-3">None.</p>}
      </Card>
    </div>
  );
}
