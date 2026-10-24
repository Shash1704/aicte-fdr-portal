import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Printer } from 'lucide-react';
import { api, download, qs } from '../lib/api';
import { fmtDate, fmtDateTime, inr, num } from '../lib/format';
import { Button, Card, Empty, PageHeader, Select, Spinner } from '../components/ui';
import { useParamsState } from '../components/kit';

interface Report { name: string; title: string; description: string; param: { key: string; label: string; options: number[]; default: number } | null; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> }

const cell = (key: string, v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (/amount|held|required|shortfall|\(Rs\)/i.test(key) && typeof v === 'number') return inr(v);
  if (key === 'at') return fmtDateTime(String(v));
  if (/(_date|_on|^maturity$|maturity|hold_until|detected|resolved|requested_on|released_on)$/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return fmtDate(String(v).slice(0, 10));
  return typeof v === 'number' ? num(v) : String(v);
};

export default function Reports() {
  const { values, set } = useParamsState(['name', 'days']);
  const { data: list } = useQuery({ queryKey: ['reports'], queryFn: () => api<Array<{ name: string; title: string; description: string }>>('/reports') });
  const name = values.name || 'pending-verification';
  const { data: rep, isFetching } = useQuery({ queryKey: ['report', name, values.days], queryFn: () => api<Report>(`/reports/${name}${qs({ days: values.days })}`) });
  const linkKey = rep?.columns.find((c) => c.key === 'ref_no');
  return (
    <div>
      <PageHeader title="Reports" subtitle="Management information for the Regulation Bureau; every report exports to CSV and prints to PDF"
        actions={<>
          <Button onClick={() => window.print()}><Printer className="size-4" />Print</Button>
          <Button onClick={() => download(`/reports/${name}${qs({ days: values.days, format: 'csv' })}`, `${name}.csv`)}><Download className="size-4" />CSV</Button>
        </>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav className="no-print space-y-1" aria-label="Reports">
          {list?.map((r) => (
            <button key={r.name} onClick={() => set({ name: r.name, days: undefined })} className={clsx('block w-full rounded-[8px] px-3 py-2.5 text-left transition', name === r.name ? 'btn-raised' : 'hover:bg-surface-2')}>
              <span className="block text-sm font-medium">{r.title}</span>
              <span className={clsx('block text-[11px]', name === r.name ? 'text-white/60' : 'text-ink-3')}>{r.description}</span>
            </button>
          ))}
        </nav>
        <Card title={rep?.title} subtitle={rep && `${rep.description} · ${num(rep.rows.length)} rows${isFetching ? ' · updating…' : ''}`} bodyClass="p-0"
          actions={rep?.param ? (
            <Select className="w-40" value={values.days || String(rep.param.default)} onChange={(e) => set({ days: e.target.value })}>
              {rep.param.options.map((o) => <option key={o} value={o}>{`Next ${o} days`}</option>)}
            </Select>
          ) : undefined}>
          {!rep ? <Spinner /> : !rep.rows.length ? <Empty title="Nothing to report" /> : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 border-b border-hairline bg-[var(--panel-solid)]"><tr>{rep.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-3">{c.label}</th>)}</tr></thead>
                <tbody className="tnum">
                  {rep.rows.slice(0, 500).map((r, i) => (
                    <tr key={i} className="border-b border-hairline last:border-0">
                      {rep.columns.map((c) => (
                        <td key={c.key} className="max-w-64 truncate px-3 py-2" title={String(r[c.key] ?? '')}>
                          {c === linkKey && r.id ? <Link className="text-accent-text hover:underline" to={`/instruments/${r.id}`}>{String(r[c.key])}</Link> : cell(c.key, r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
