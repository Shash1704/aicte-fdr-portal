import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Fingerprint, Landmark, RotateCcw, Save, ShieldAlert, XCircle } from 'lucide-react';
import { api, DEMO, qs } from '../lib/api';
import { useAuth, useLookups, useToast } from '../lib/context';
import { fmtDate, fmtDateTime, inr } from '../lib/format';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs } from '../components/ui';

interface Settings {
  monitoring: { reminder_ladder: number[]; overdue_repeat_days: number; escalation_days: number[]; scrutiny_sla_days: number; query_response_days: number; release_sla_days: number; reverify_days: number; minutes_per_manual_letter: number };
  requirements: Array<{ id: number; purpose: string; inst_type: string; min_amount: number; min_tenure_months: number; hold_years: number; accepted_types: string }>;
  clock: { today: string; offset: number };
}
type Tab = 'clock' | 'rules' | 'requirements' | 'audit' | 'sandbox';

export default function Admin() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>(admin ? 'clock' : 'audit');
  const { data } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<Settings>('/admin/settings'), enabled: user?.role !== 'auditor' || true });
  return (
    <div>
      <PageHeader title="Administration" subtitle="Monitoring rules, requirement norms, audit trail and demo controls" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        ...(admin ? [{ value: 'clock' as Tab, label: 'Time machine (demo)' }] : []),
        { value: 'rules', label: 'Monitoring rules' }, { value: 'requirements', label: 'Requirement norms' },
        ...(['admin', 'auditor'].includes(user?.role ?? '') ? [{ value: 'audit' as Tab, label: 'Audit trail' }] : []),
        { value: 'sandbox', label: 'Bank sandbox' },
      ]} />
      {!data ? <Spinner /> : tab === 'clock' ? <Clock s={data} /> : tab === 'rules' ? <Rules s={data} editable={admin} /> : tab === 'requirements' ? <Requirements s={data} editable={admin} /> : tab === 'audit' ? <Audit /> : <Sandbox />}
    </div>
  );
}

function Clock({ s }: { s: Settings }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ today: string; offset: number }>('/admin/clock', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div id="clock" className="grid gap-5 lg:grid-cols-2">
      <Card title="Move the system date forward" subtitle="Shows maturity tracking, reminders and escalation happening, without waiting weeks">
        <div className="flex items-center gap-3 text-sm"><CalendarClock className="size-5 text-ink-3" />System date: <b>{fmtDate(s.clock.today)}</b>{s.clock.offset ? <span className="text-warning-text">(+{s.clock.offset} days)</span> : <span className="text-ink-3">(real date)</span>}</div>
        <div className="mt-5 flex flex-wrap gap-2">
          {[7, 30, 90].map((d) => <Button key={d} variant="primary" loading={m.isPending} onClick={() => m.mutate({ days: d })}>+{d} days</Button>)}
          <Button loading={m.isPending} disabled={!s.clock.offset} onClick={() => m.mutate({ reset: true })}><RotateCcw className="size-4" />Back to today</Button>
        </div>
        <p className="mt-4 text-xs text-ink-3">The monitoring job runs once for every day skipped, so each T-90/60/30/15/7/0 reminder, maturity, overdue notice, escalation and periodic bank re-check fires on its proper date. Going back only changes the displayed date; messages already sent stay sent.</p>
        <ErrorBox error={m.error} />
      </Card>
      {DEMO && (
        <Card title="Reset demo data" subtitle="Everything you changed is saved in this browser only">
          <Button onClick={() => import('../demo/server.js').then((d) => d.resetDemoData())}><RotateCcw className="size-4" />Regenerate demo data</Button>
        </Card>
      )}
    </div>
  );
}

function Rules({ s, editable }: { s: Settings; editable: boolean }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [v, setV] = useState(() => ({ ...s.monitoring, reminder_ladder: s.monitoring.reminder_ladder.join(', '), escalation_days: s.monitoring.escalation_days.join(', ') }));
  const m = useMutation({ mutationFn: () => api('/admin/settings', { method: 'POST', body: { monitoring: v } }), onSuccess: () => { qc.invalidateQueries(); push({ tone: 'good', title: 'Monitoring rules saved' }); } });
  const row = (k: keyof typeof v, label: string, hint: string) => (
    <Field label={label} hint={hint}><Input disabled={!editable} value={String(v[k])} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} /></Field>
  );
  return (
    <Card title="Monitoring rules" subtitle="Applied by the daily monitoring job" actions={editable ? <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}><Save className="size-4" />Save</Button> : undefined}>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {row('reminder_ladder', 'Reminder ladder (days before maturity)', 'e.g. 90, 60, 30, 15, 7, 0. SMS is added from 15 days.')}
        {row('overdue_repeat_days', 'Repeat overdue notice every (days)', 'After maturity, until a renewal arrives')}
        {row('escalation_days', 'Escalate when overdue by (days)', 'Officer, Director, Competent Authority')}
        {row('scrutiny_sla_days', 'Verification timeline (days)', 'Alert when a submission waits longer')}
        {row('query_response_days', 'Default reply time for queries (days)', '')}
        {row('release_sla_days', 'Release processing timeline (days)', '')}
        {row('reverify_days', 'Re-check held deposits with the bank every (days)', 'Catches premature encashment')}
        {row('minutes_per_manual_letter', 'Minutes per manual letter', 'Used to estimate staff time saved')}
      </div>
      <ErrorBox error={m.error} />
    </Card>
  );
}

function Requirements({ s, editable }: { s: Settings; editable: boolean }) {
  const { purposeName } = useLookups();
  const qc = useQueryClient();
  const { push } = useToast();
  const [rows, setRows] = useState(s.requirements);
  const [purpose, setPurpose] = useState('NEW_INST');
  useEffect(() => setRows(s.requirements), [s.requirements]);
  const m = useMutation({ mutationFn: () => api('/admin/requirements', { method: 'POST', body: { rows } }), onSuccess: () => { qc.invalidateQueries(); push({ tone: 'good', title: 'Requirement norms saved' }); } });
  const upd = (id: number, k: string, val: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: k === 'accepted_types' ? val : Number(val) } : r)));
  return (
    <Card title="Requirement norms" subtitle="Illustrative values: set them to the current Approval Process Handbook. New submissions are checked against these."
      actions={<>
        <Select className="w-64" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{[...new Set(s.requirements.map((r) => r.purpose))].map((p) => <option key={p} value={p}>{purposeName(p)}</option>)}</Select>
        {editable && <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}><Save className="size-4" />Save</Button>}
      </>} bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-hairline bg-surface-1"><tr className="text-left text-xs text-ink-3">
            <th className="px-3 py-2 font-medium">Institution type</th><th className="px-3 py-2 font-medium">Minimum amount (₹)</th><th className="px-3 py-2 font-medium">Min. tenure (months)</th>
            <th className="px-3 py-2 font-medium">Hold for (years)</th><th className="px-3 py-2 font-medium">Accepted instruments</th>
          </tr></thead>
          <tbody>
            {rows.filter((r) => r.purpose === purpose).map((r) => (
              <tr key={r.id} className="border-b border-hairline last:border-0">
                <td className="px-3 py-2">{r.inst_type}</td>
                <td className="px-3 py-2"><Input disabled={!editable} type="number" value={r.min_amount} onChange={(e) => upd(r.id, 'min_amount', e.target.value)} className="w-36" /><div className="text-[11px] text-ink-3">{inr(r.min_amount)}</div></td>
                <td className="px-3 py-2"><Input disabled={!editable} type="number" value={r.min_tenure_months} onChange={(e) => upd(r.id, 'min_tenure_months', e.target.value)} className="w-20" /></td>
                <td className="px-3 py-2"><Input disabled={!editable} type="number" value={r.hold_years} onChange={(e) => upd(r.id, 'hold_years', e.target.value)} className="w-20" /></td>
                <td className="px-3 py-2"><Input disabled={!editable} value={r.accepted_types} onChange={(e) => upd(r.id, 'accepted_types', e.target.value)} className="w-32" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3"><ErrorBox error={m.error} /></div>
    </Card>
  );
}

function Audit() {
  const { data } = useQuery({ queryKey: ['audit'], queryFn: () => api<Array<{ id: number; at: string; user_name: string | null; username: string | null; action: string; entity: string | null; entity_id: string | null; details: string | null; hash: string }>>('/audit?limit=300') });
  const verify = useMutation({ mutationFn: () => api<{ ok: boolean; checked: number; brokenAt: number | null }>('/audit/verify') });
  return (
    <div className="space-y-5">
      <Card title="Integrity of the audit trail" subtitle="Each entry carries the SHA-256 hash of the previous one; editing or deleting any entry breaks the chain">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={verify.isPending} onClick={() => verify.mutate()}><Fingerprint className="size-4" />Verify the chain</Button>
          {verify.data && (verify.data.ok
            ? <span className="flex items-center gap-1.5 text-sm text-good-text"><CheckCircle2 className="size-4" />Intact: {verify.data.checked} entries verified</span>
            : <span className="flex items-center gap-1.5 text-sm text-critical-text"><XCircle className="size-4" />Tampering detected at entry #{verify.data.brokenAt}</span>)}
        </div>
      </Card>
      <Card title="Recent entries" bodyClass="p-0">
        {!data ? <Spinner /> : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 border-b border-hairline bg-[var(--panel-solid)]"><tr className="text-left text-xs text-ink-3">
                <th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Who</th><th className="px-3 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">On</th><th className="px-3 py-2 font-medium">Hash</th>
              </tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-1.5 tnum text-ink-3">{a.id}</td><td className="whitespace-nowrap px-3 py-1.5">{fmtDateTime(a.at)}</td>
                    <td className="px-3 py-1.5">{a.user_name ?? <span className="text-ink-3">{a.action === 'auth.failed' ? a.entity_id : 'System'}</span>}</td>
                    <td className="px-3 py-1.5"><code className="text-xs">{a.action}</code></td>
                    <td className="max-w-48 truncate px-3 py-1.5 text-ink-2" title={a.details ?? ''}>{a.entity} {a.entity_id}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-ink-3">{a.hash.slice(0, 12)}</td>
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

function Sandbox() {
  const { meta } = useLookups();
  const [bank, setBank] = useState('SBI');
  const [no, setNo] = useState('');
  const look = useMutation({ mutationFn: () => api<{ status: string; bank?: string; record?: Record<string, unknown>; ref: string }>(`/bank-sandbox/lookup${qs({ bank, no })}`) });
  return (
    <Card title="Bank verification sandbox" subtitle="SIMULATED. Stands in for each bank's authorised deposit-verification service; answers from the bank's own books, never from the institution's form">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Bank" className="w-56"><Select value={bank} onChange={(e) => setBank(e.target.value)}>{meta?.banks.map((b) => <option key={b.code} value={b.code}>{b.name}{b.api ? '' : ' (not connected)'}</option>)}</Select></Field>
        <Field label="Instrument number" className="w-64"><Input value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Button variant="primary" loading={look.isPending} onClick={() => look.mutate()}><Landmark className="size-4" />Look up</Button>
      </div>
      {look.data && (
        <div className="mt-5 rounded-[16px] border border-[var(--hairline)] p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">{look.data.status === 'found' ? <CheckCircle2 className="size-4 text-good-text" /> : <ShieldAlert className="size-4 text-warning-text" />}{look.data.status} <span className="text-xs font-normal text-ink-3">ref {look.data.ref}</span></div>
          {look.data.record && <pre className="mt-2 overflow-auto text-xs text-ink-2">{JSON.stringify(look.data.record, null, 2)}</pre>}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-3">In production each connected bank would be integrated under a formal agreement (or through RBI's Account Aggregator framework with the depositor's consent). Banks without a service are handled through confirmation letters.</p>
    </Card>
  );
}
