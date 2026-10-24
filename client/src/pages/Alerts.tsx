import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCheck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/context';
import { relTime } from '../lib/format';
import type { Alert } from '../lib/types';
import { Button, Card, Empty, PageHeader, Select, SeverityBadge, Spinner, Tabs } from '../components/ui';

const TYPES: Record<string, string> = {
  BANK_ALERT: 'Bank alerts', LAPSED: 'Renewal overdue', EXPIRING: 'Maturing soon', DISCREPANCY: 'Critical discrepancies', VERIFY_PENDING: 'Verification pending',
  QUERY: 'Queries', RELEASE: 'Release requests',
};

export default function Alerts() {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [state, setState] = useState<'open' | 'resolved'>('open');
  const [severity, setSeverity] = useState('');
  const { data } = useQuery({ queryKey: ['alerts', type, state, severity], queryFn: () => api<{ rows: Alert[]; counts: Array<{ type: string; severity: string; n: number }> }>(`/alerts${qs({ type, state, severity })}`) });
  const readAll = useMutation({ mutationFn: () => api('/alerts/read-all', { method: 'POST' }), onSuccess: () => qc.invalidateQueries() });
  const counts = (t: string) => data?.counts.filter((c) => !t || c.type === t).reduce((s, c) => s + c.n, 0);
  const open = (a: Alert) => { api(`/alerts/${a.id}/read`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['alerts-summary'] })).catch(() => {}); nav(a.release_id ? `/releases/${a.release_id}` : a.instrument_id ? `/instruments/${a.instrument_id}` : '/'); };
  return (
    <div>
      <PageHeader title={user?.role === 'institution' ? 'Notifications' : 'Alerts'} subtitle="Raised and cleared automatically as the records change"
        actions={<Button onClick={() => readAll.mutate()} loading={readAll.isPending}><CheckCheck className="size-4" />Mark all read</Button>} />
      <Tabs value={type} onChange={setType} tabs={[{ value: '', label: 'All', count: counts('') }, ...Object.entries(TYPES).filter(([k]) => counts(k)).map(([k, l]) => ({ value: k, label: l, count: counts(k) }))]} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-40" value={state} onChange={(e) => setState(e.target.value as 'open' | 'resolved')}><option value="open">Active</option><option value="resolved">Cleared</option></Select>
        <Select className="w-40" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">Any severity</option><option value="critical">Critical</option><option value="serious">Serious</option><option value="warning">Warning</option><option value="info">Info</option></Select>
      </div>
      <Card bodyClass="p-0">
        {!data ? <Spinner /> : !data.rows.length ? <Empty title="No alerts" body="Nothing needs attention here." /> : (
          <ul className="divide-y divide-[var(--hairline)]">
            {data.rows.map((a) => (
              <li key={a.id}>
                <button onClick={() => open(a)} className={clsx('flex w-full flex-wrap items-start gap-3 px-4 py-3 text-left hover:bg-surface-2', !a.read && 'bg-surface-1')}>
                  <SeverityBadge severity={a.severity} label={TYPES[a.type]?.replace(/s$/, '') ?? a.type} />
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block text-sm', !a.read && 'font-semibold')}>{a.title}</span>
                    {a.message && <span className="block text-xs text-ink-3">{a.message}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">{relTime(a.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
