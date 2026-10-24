import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useLookups } from '../lib/context';
import { fmtDate, inrShort, num } from '../lib/format';
import { Card, Empty, Input, PageHeader, Select, Spinner, ToneBadge } from '../components/ui';
import { Pager, useParamsState } from '../components/kit';

interface Row { id: number; aicte_id: string; name: string; city: string; state: string; region_code: string; type: string; approval_status: string; open_cases: number; dues_outstanding: number; instruments: number; held: number; pending: number; lapsed: number; alerts: number; next_maturity: string | null }

export default function Institutions() {
  const { values, set } = useParamsState(['q', 'region', 'type', 'attention', 'sort', 'page']);
  const { meta } = useLookups();
  const nav = useNavigate();
  const [q, setQ] = useState(values.q);
  useEffect(() => { const t = setTimeout(() => { if (q !== values.q) set({ q }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data } = useQuery({ queryKey: ['institutions', values], queryFn: () => api<{ total: number; rows: Row[] }>(`/institutions${qs({ ...values, size: 50 })}`), placeholderData: keepPreviousData });
  const page = Number(values.page) || 1;
  return (
    <div>
      <PageHeader title="Institutions" subtitle="Institution-wise deposits, compliance and open issues" />
      <Card className="mb-4" bodyClass="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1"><Search className="pointer-events-none absolute left-1 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input className="pl-7" placeholder="Name, AICTE ID or city" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="w-full sm:w-44" value={values.region} onChange={(e) => set({ region: e.target.value })}><option value="">All regions</option>{meta?.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</Select>
          <Select className="w-full sm:w-44" value={values.type} onChange={(e) => set({ type: e.target.value })}><option value="">All types</option>{meta?.institutionTypes.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select className="w-full sm:w-44" value={values.sort} onChange={(e) => set({ sort: e.target.value })}><option value="">Most issues first</option><option value="held">Largest holdings</option><option value="name">Name</option></Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.attention === '1'} onChange={(e) => set({ attention: e.target.checked ? '1' : undefined })} />Needing attention</label>
        </div>
      </Card>
      <Card bodyClass="p-0">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5 text-sm"><span>{data ? <><b className="tnum">{num(data.total)}</b> institutions</> : '—'}</span><Pager page={page} pages={data ? Math.ceil(data.total / 50) : 1} onPage={(p) => set({ page: String(p) })} /></div>
        {!data ? <Spinner /> : !data.rows.length ? <Empty title="No institutions match" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-hairline bg-surface-1"><tr className="text-left text-xs text-ink-3">
                <th className="px-3 py-2 font-medium">Institution</th><th className="px-3 py-2 font-medium">Region · type</th><th className="px-3 py-2 text-right font-medium">Held</th>
                <th className="px-3 py-2 text-right font-medium">Instruments</th><th className="px-3 py-2 font-medium">Next maturity</th><th className="px-3 py-2 font-medium">Issues</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-2" onClick={() => nav(`/institutions/${r.id}`)}>
                    <td className="max-w-72 px-3 py-2.5"><Link to={`/institutions/${r.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link><div className="text-xs text-ink-3">{r.aicte_id} · {r.city}, {r.state}</div></td>
                    <td className="px-3 py-2.5 text-ink-2">{r.region_code}<div className="text-xs text-ink-3">{r.type}</div></td>
                    <td className="px-3 py-2.5 text-right tnum">{r.held ? inrShort(r.held) : '—'}</td>
                    <td className="px-3 py-2.5 text-right tnum">{r.instruments}</td>
                    <td className="px-3 py-2.5 tnum">{fmtDate(r.next_maturity)}</td>
                    <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">
                      {!!r.lapsed && <ToneBadge tone="critical">{r.lapsed} lapsed</ToneBadge>}
                      {!!r.alerts && <ToneBadge tone="critical">bank alert</ToneBadge>}
                      {!!r.pending && <ToneBadge tone="info">{r.pending} pending</ToneBadge>}
                      {!!r.open_cases && <ToneBadge tone="warning">{r.open_cases} ICMS case{r.open_cases > 1 ? 's' : ''}</ToneBadge>}
                      {r.approval_status !== 'Approved' && <ToneBadge tone="muted">{r.approval_status}</ToneBadge>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
