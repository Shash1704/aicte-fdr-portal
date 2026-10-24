import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/context';
import { fmtDate, inrShort } from '../lib/format';
import type { InstrumentRow, Release } from '../lib/types';
import { Card, Empty, PageHeader, Spinner, StatusBadge, Tabs, ToneBadge } from '../components/ui';
import { InstrumentTable } from '../components/kit';

type Tab = 'verify' | 'queries' | 'renewals' | 'bank' | 'releases';

export default function Desk() {
  const { user } = useAuth();
  const officer = user?.role === 'officer';
  const [mine, setMine] = useState(officer);
  const m = mine ? '&mine=1' : '';
  const q = (key: string, path: string) => useQuery({ queryKey: ['instruments', 'desk', key, mine], queryFn: () => api<{ total: number; rows: InstrumentRow[] }>(path) }); // eslint-disable-line react-hooks/rules-of-hooks
  const verify = q('verify', `/instruments?status=Submitted,Under Scrutiny&sort=age&dir=asc&size=100${m}`);
  const queries = q('queries', `/instruments?status=Query Raised&sort=age&dir=asc&size=100${m}`);
  const renewals = q('renewals', `/instruments?validity=expiring,lapsed&sort=maturity&dir=asc&size=100${m}`);
  const bank = q('bank', `/instruments?bank_status=encashed,not_found,mismatch&status=Active,Matured,Release Requested&size=100${m}`);
  const { data: releases } = useQuery({ queryKey: ['releases', 'mine'], queryFn: () => api<Release[]>('/releases?status=mine') });
  const defaultTab: Tab = user?.role === 'accounts' || user?.role === 'admin' ? 'releases' : 'verify';
  const [tab, setTab] = useState<Tab>(defaultTab);
  const current = { verify, queries, renewals, bank }[tab as Exclude<Tab, 'releases'>];

  return (
    <div>
      <PageHeader title="My desk" subtitle={officer ? 'Work waiting on you, oldest first' : 'Work waiting across the Regulation Bureau'}
        actions={officer ? <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only my regions</label> : undefined} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'verify', label: 'To verify', count: verify.data?.total },
        { value: 'queries', label: 'Awaiting reply', count: queries.data?.total },
        { value: 'renewals', label: 'Renewals due / overdue', count: renewals.data?.total },
        { value: 'bank', label: 'Bank alerts', count: bank.data?.total },
        { value: 'releases', label: 'Releases waiting on me', count: releases?.length },
      ]} />
      {tab === 'releases' ? (
        <Card bodyClass="p-0">
          {!releases ? <Spinner /> : !releases.length ? <Empty title="No release requests are waiting on you" /> : <ReleaseTable rows={releases} />}
        </Card>
      ) : (
        <Card bodyClass="p-0">
          {!current?.data ? <Spinner /> : !current.data.rows.length ? <Empty title="Nothing here" body="All caught up." /> : <InstrumentTable rows={current.data.rows} />}
        </Card>
      )}
    </div>
  );
}

export function ReleaseTable({ rows }: { rows: Release[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-hairline bg-surface-1"><tr className="text-left text-xs text-ink-3">
          <th className="px-3 py-2 font-medium">Request</th><th className="px-3 py-2 font-medium">Institution</th><th className="px-3 py-2 font-medium">Instrument</th>
          <th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">Stage</th><th className="px-3 py-2 font-medium">Conditions</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const failing = r.checklist.filter((c) => !c.ok).length;
            return (
              <tr key={r.id} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                <td className="px-3 py-2.5"><Link to={`/releases/${r.id}`} className="font-medium text-accent-text hover:underline">{r.req_no}</Link><div className="text-xs text-ink-3">{fmtDate(r.requested_at)}{r.age_days !== undefined && ` · ${r.age_days} d`}</div></td>
                <td className="max-w-52 px-3 py-2.5"><div className="truncate">{r.institution_name}</div><div className="text-xs text-ink-3">{r.aicte_id}</div></td>
                <td className="px-3 py-2.5"><Link to={`/instruments/${r.instrument_id}`} className="hover:underline">{r.ref_no}</Link><div className="text-xs text-ink-3">{r.type} {r.instrument_no}</div></td>
                <td className="px-3 py-2.5 text-right tnum">{inrShort(r.amount)}</td>
                <td className="px-3 py-2.5"><StatusBadge status={r.status === 'Released' ? 'Released' : r.status === 'Rejected' ? 'Rejected' : 'Release Requested'} /><div className="mt-0.5 text-xs text-ink-3">{r.status}</div></td>
                <td className="px-3 py-2.5">{failing ? <ToneBadge tone="warning">{failing} pending</ToneBadge> : <ToneBadge tone="good">All met</ToneBadge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
