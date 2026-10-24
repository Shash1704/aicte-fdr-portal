import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FilePlus2, Printer, Search, SlidersHorizontal, X } from 'lucide-react';
import { api, download, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/context';
import { fmtDate, inrShort, num } from '../lib/format';
import { VALIDITY } from '../lib/colors';
import type { InstrumentRow } from '../lib/types';
import { Button, Card, Empty, ErrorBox, Input, PageHeader, Select, Spinner } from '../components/ui';
import { InstrumentTable, Pager, useParamsState } from '../components/kit';

const KEYS = ['q', 'status', 'validity', 'type', 'purpose', 'bank', 'region', 'verification', 'bank_status', 'issues', 'mine', 'escalated', 'maturity_from', 'maturity_to', 'institution_id', 'sort', 'dir', 'page'];
const STATUS_GROUPS: Array<[string, string]> = [
  ['Submitted,Under Scrutiny,Query Raised', 'Pending verification'], ['Active,Matured,Release Requested', 'Held on record'], ['Active', 'Active'], ['Matured', 'Matured'],
  ['Renewed', 'Renewed'], ['Release Requested', 'Release requested'], ['Released', 'Released'], ['Rejected', 'Rejected'], ['Query Raised', 'Query raised'],
];

export default function Register() {
  const { values, set } = useParamsState(KEYS);
  const { meta, purposeName, bankName, regionName } = useLookups();
  const { user } = useAuth();
  const staff = user?.role !== 'institution';
  const [q, setQ] = useState(values.q);
  const [more, setMore] = useState(() => !!(values.bank || values.verification || values.maturity_from || values.region));
  useEffect(() => setQ(values.q), [values.q]);
  useEffect(() => { const t = setTimeout(() => { if (q !== values.q) set({ q }); }, 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['instruments', values],
    queryFn: () => api<{ total: number; amount: number; page: number; size: number; rows: InstrumentRow[] }>(`/instruments${qs({ ...values, size: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const page = Number(values.page) || 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const active = KEYS.filter((k) => !['sort', 'dir', 'page'].includes(k) && values[k]);
  const sortBy = (key: string) => set({ sort: key, dir: values.sort === key && values.dir !== 'asc' ? 'asc' : 'desc', page: undefined });
  const label = (k: string, v: string) => ({
    q: `“${v}”`, status: STATUS_GROUPS.find(([s]) => s === v)?.[1] ?? v, validity: v.split(',').map((x) => VALIDITY[x]?.label ?? x).join(' / '), type: v, purpose: purposeName(v),
    bank: bankName(v), region: regionName(v), verification: v === 'bank' ? 'Bank-confirmed' : v, bank_status: `Bank: ${v}`, issues: v === 'blocking' ? 'Blocking discrepancies' : 'Open discrepancies',
    mine: 'Assigned to me', escalated: 'Escalated', maturity_from: `Matures from ${fmtDate(v)}`, maturity_to: `Matures by ${fmtDate(v)}`, institution_id: `Institution #${v}`,
  } as Record<string, string>)[k] ?? `${k}: ${v}`;

  return (
    <div>
      <PageHeader title={staff ? 'Deposit register' : 'My deposits'} subtitle={staff ? 'Every security deposit, FDR and bank guarantee, institution-wise and instrument-wise' : 'Your security deposits, FDRs and bank guarantees held by AICTE'}
        actions={<>
          <Button onClick={() => window.print()}><Printer className="size-4" />Print</Button>
          <Button onClick={() => download(`/instruments${qs({ ...values, format: 'csv' })}`, 'register.csv')}><Download className="size-4" />CSV</Button>
          {user?.role !== 'auditor' && user?.role !== 'accounts' && <Link to="/submit"><Button variant="primary"><FilePlus2 className="size-4" />{staff ? 'Record deposit' : 'Submit FDR'}</Button></Link>}
        </>} />

      <Card className="no-print mb-4" bodyClass="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-1 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input className="pl-7" placeholder="FDR / BG number, reference, institution, AICTE ID, city…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-full sm:w-48" aria-label="Status" value={values.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            {STATUS_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select className="w-full sm:w-48" aria-label="Validity" value={values.validity} onChange={(e) => set({ validity: e.target.value })}>
            <option value="">Any validity</option>
            <option value="expiring">Renewal due (≤ 90 days)</option>
            <option value="lapsed">Renewal overdue</option>
            <option value="renewal_submitted">Renewal submitted</option>
            <option value="maturing">Maturing, no renewal needed</option>
            <option value="complete">Holding period over</option>
            <option value="valid">Valid</option>
          </Select>
          {staff && (
            <Select className="w-full sm:w-44" aria-label="Discrepancies" value={values.issues} onChange={(e) => set({ issues: e.target.value })}>
              <option value="">Any discrepancies</option>
              <option value="open">With open discrepancies</option>
              <option value="blocking">With blocking discrepancies</option>
            </Select>
          )}
          <Button variant="ghost" onClick={() => setMore((s) => !s)}><SlidersHorizontal className="size-4" />{more ? 'Fewer' : 'More'}</Button>
        </div>
        {more && (
          <div className="mt-3 grid gap-x-4 gap-y-2 border-t border-hairline pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select aria-label="Type" value={values.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">All instrument types</option>
              {meta?.types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </Select>
            <Select aria-label="Purpose" value={values.purpose} onChange={(e) => set({ purpose: e.target.value })}>
              <option value="">All purposes</option>
              {meta?.purposes.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </Select>
            <Select aria-label="Bank" value={values.bank} onChange={(e) => set({ bank: e.target.value })}>
              <option value="">All banks</option>
              {meta?.banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            </Select>
            {staff ? (
              <Select aria-label="Region" value={values.region} onChange={(e) => set({ region: e.target.value })}>
                <option value="">All regions</option>
                {meta?.regions.map((r) => <option key={r.code} value={r.code}>{r.name} ({r.office})</option>)}
              </Select>
            ) : <div />}
            <Select aria-label="Verification" value={values.verification} onChange={(e) => set({ verification: e.target.value })}>
              <option value="">Any verification</option>
              <option value="bank">Bank-confirmed (online or letter)</option>
              <option value="bank_api">Bank-confirmed online</option>
              <option value="bank_letter">Bank letter</option>
              <option value="officer">Officer-verified only</option>
              <option value="unverified">Not yet verified</option>
            </Select>
            <label className="block"><span className="eyebrow text-[9.5px] text-ink-3">Matures from</span><Input type="date" value={values.maturity_from} onChange={(e) => set({ maturity_from: e.target.value })} /></label>
            <label className="block"><span className="eyebrow text-[9.5px] text-ink-3">Matures by</span><Input type="date" value={values.maturity_to} onChange={(e) => set({ maturity_to: e.target.value })} /></label>
            {user?.role === 'officer' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.mine === '1'} onChange={(e) => set({ mine: e.target.checked ? '1' : undefined })} />Assigned to me</label>}
          </div>
        )}
        {!!active.length && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {active.map((k) => (
              <button key={k} onClick={() => set({ [k]: undefined })} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-text hover:brightness-95">
                {label(k, values[k])}<X className="size-3" />
              </button>
            ))}
            <button className="text-xs text-ink-3 hover:underline" onClick={() => set(Object.fromEntries(KEYS.map((k) => [k, undefined])))}>Clear all</button>
          </div>
        )}
      </Card>

      <ErrorBox error={error} />
      <Card bodyClass="p-0">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5 text-sm">
          <span className="text-ink-2">{data ? <><b className="tnum text-ink">{num(data.total)}</b> instrument{data.total === 1 ? '' : 's'} · <span className="tnum">{inrShort(data.amount)}</span></> : '—'}{isFetching && <span className="ml-2 text-xs text-ink-3">updating…</span>}</span>
          <Pager page={page} pages={pages} onPage={(p) => set({ page: String(p) })} />
        </div>
        {isLoading ? <Spinner /> : !data?.rows.length ? <Empty title="No instruments match these filters" body="Try removing a filter." /> : (
          <InstrumentTable rows={data.rows} showInstitution={staff} sort={{ current: values.sort || 'submitted', dir: values.dir, onSort: sortBy }} />
        )}
        {data && data.total > data.size && <div className="flex justify-end border-t border-hairline px-4 py-2.5"><Pager page={page} pages={pages} onPage={(p) => set({ page: String(p) })} /></div>}
      </Card>
    </div>
  );
}
