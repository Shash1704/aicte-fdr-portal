import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CheckCircle2, CircleDashed, FileText, Lock, Send, Undo2, X, XCircle } from 'lucide-react';
import { api, openDocument } from '../lib/api';
import { useAuth, useLookups, useToast } from '../lib/context';
import { fmtDate, fmtDateTime, inr } from '../lib/format';
import type { Release } from '../lib/types';
import { Button, Card, ErrorBox, Field, KeyVal, PageHeader, Spinner, Textarea, ToneBadge } from '../components/ui';

const STAGES: Array<{ key: string; label: string; who: string; at: keyof Release; by: keyof Release }> = [
  { key: 'Submitted', label: 'Requested', who: 'Institution', at: 'requested_at', by: 'requested_by_name' },
  { key: 'Recommended', label: 'Scrutinised (maker)', who: 'Dealing officer', at: 'recommended_at', by: 'recommended_by_name' },
  { key: 'Forwarded', label: 'Checked (checker)', who: 'Director, RB', at: 'forwarded_at', by: 'forwarded_by_name' },
  { key: 'Approved', label: 'Approved', who: 'Competent Authority', at: 'approved_at', by: 'approved_by_name' },
  { key: 'Released', label: 'Released', who: 'Accounts', at: 'released_at', by: 'released_by_name' },
];
const NEXT: Record<string, { role: string[]; action: string; label: string }> = {
  Submitted: { role: ['officer', 'head'], action: 'recommend', label: 'Recommend release' },
  Recommended: { role: ['head'], action: 'forward', label: 'Forward to Competent Authority' },
  Forwarded: { role: ['admin'], action: 'approve', label: 'Approve release' },
  Approved: { role: ['accounts'], action: 'release', label: 'Issue release letter' },
  Returned: { role: ['institution', 'officer', 'head', 'admin'], action: 'resubmit', label: 'Resubmit with clarification' },
};

export default function ReleaseDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { reasonName } = useLookups();
  const qc = useQueryClient();
  const { push } = useToast();
  const [remarks, setRemarks] = useState('');
  const { data: r, error, isLoading } = useQuery({ queryKey: ['release', id], queryFn: () => api<Release>(`/releases/${id}`) });
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Release>(`/releases/${id}/act`, { method: 'POST', body }),
    onSuccess: (out, body) => { qc.invalidateQueries(); if (body.action !== 'check') { setRemarks(''); push({ tone: 'good', title: `${out.req_no}: ${out.status}` }); } },
    onError: (e) => push({ tone: 'critical', title: (e as Error).message }),
  });
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !r) return <Spinner />;
  const stageIdx = STAGES.findIndex((s) => s.key === r.status);
  const next = NEXT[r.status];
  const canNext = next && user && next.role.includes(user.role);
  const open = !['Released', 'Rejected'].includes(r.status);
  const canReturn = open && ['officer', 'head', 'admin'].includes(user?.role ?? '') && ['Submitted', 'Recommended', 'Forwarded'].includes(r.status);
  const canReject = open && ['head', 'admin'].includes(user?.role ?? '');
  const canTick = (c: Release['checklist'][number]) => open && r.status !== 'Returned' && !c.auto && (user?.role === c.role || user?.role === 'admin' || (c.role === 'officer' && user?.role === 'head'));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader crumbs={[{ label: 'Releases', to: '/releases' }, { label: r.req_no }]} title={r.req_no}
        subtitle={<>{reasonName(r.reason)} · <Link to={`/instruments/${r.instrument_id}`} className="hover:underline">{r.ref_no} ({r.type} {r.instrument_no})</Link> · {r.institution_name}</>} />

      <Card className="mb-5" bodyClass="p-4 sm:p-5">
        <ol className="grid gap-3 sm:grid-cols-5">
          {STAGES.map((s, i) => {
            const done = !!r[s.at] && (i <= stageIdx || r.status === 'Released' || (r.status === 'Returned' && i === 0));
            const current = i === stageIdx + 1 && open && r.status !== 'Returned';
            return (
              <li key={s.key} className={clsx('rounded-[8px] p-3', done ? 'bg-good-soft' : current ? 'border border-ink' : 'tile')}>
                <div className="flex items-center gap-1.5 text-xs font-medium">{done ? <CheckCircle2 className="size-4 text-good-text" /> : current ? <CircleDashed className="size-4" /> : <CircleDashed className="size-4 text-muted" />}{s.label}</div>
                <div className="mt-1 text-[11px] text-ink-3">{done ? <>{String(r[s.by] ?? s.who)}<br />{fmtDateTime(String(r[s.at]))}</> : s.who}</div>
              </li>
            );
          })}
        </ol>
        {r.status === 'Rejected' && <p className="mt-3 flex items-center gap-2 text-sm text-critical-text"><XCircle className="size-4" />Rejected: {r.closed_remarks}</p>}
        {r.status === 'Returned' && <p className="mt-3 flex items-center gap-2 text-sm text-warning-text"><Undo2 className="size-4" />Returned for clarification: {r.closed_remarks}</p>}
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card title="Conditions for release" subtitle="Checked automatically from the records where possible; the rest are confirmed by the responsible officer">
            <ul className="divide-y divide-[var(--hairline)]">
              {r.checklist.map((c) => (
                <li key={c.code} className="flex items-start gap-3 py-3">
                  <span className={clsx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', c.ok ? 'bg-good-soft text-good-text' : 'bg-critical-soft text-critical-text')}>{c.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{c.label}</div>
                    <div className="text-xs text-ink-3">{c.auto ? 'Automatic · ' : 'Manual · '}{c.detail}</div>
                  </div>
                  {canTick(c) ? (
                    <Button size="sm" variant={c.ok ? 'ghost' : 'secondary'} loading={act.isPending} onClick={() => act.mutate({ action: 'check', code: c.code, ok: !c.ok })}>{c.ok ? 'Undo' : 'Confirm'}</Button>
                  ) : !c.auto && !c.ok ? <ToneBadge tone="muted" icon={<Lock className="size-3" />}>{c.role === 'accounts' ? 'Accounts' : 'Officer'}</ToneBadge> : null}
                </li>
              ))}
            </ul>
          </Card>

          {open && (canNext || canReturn || canReject) && (
            <Card title="Your action">
              <Field label="Remarks (recorded in the history and audit trail)"><Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {canReject && <Button variant="ghost" loading={act.isPending} onClick={() => act.mutate({ action: 'reject', remarks })}><XCircle className="size-4" />Reject</Button>}
                {canReturn && <Button loading={act.isPending} onClick={() => act.mutate({ action: 'return', remarks })}><Undo2 className="size-4" />Return for clarification</Button>}
                {canNext && <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ action: next.action, remarks })}><Send className="size-4" />{next.label}</Button>}
              </div>
              <p className="mt-3 text-xs text-ink-3">Segregation of duties: the officer who recommends cannot also check or approve the same request.</p>
            </Card>
          )}
        </div>
        <aside className="space-y-5">
          <Card title="Request">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <KeyVal label="Amount"><span className="tnum">{inr(r.amount)}</span></KeyVal>
              <KeyVal label="Requested">{fmtDate(r.requested_at)}</KeyVal>
              <KeyVal label="Institution">{r.institution_name}</KeyVal>
              <KeyVal label="AICTE ID">{r.aicte_id}</KeyVal>
              {r.release_ref && <KeyVal label="Letter no.">{r.release_ref}</KeyVal>}
            </dl>
            {r.details && <p className="mt-3 whitespace-pre-line border-l-2 border-[var(--axis)] pl-3 text-sm text-ink-2">{r.details}</p>}
          </Card>
          {!!r.documents?.length && (
            <Card title="Documents">
              <ul className="space-y-1">
                {r.documents.map((d) => (
                  <li key={d.id}><button className="flex w-full items-center gap-2 rounded-[6px] px-1 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => openDocument(d.id)}><FileText className="size-4 text-ink-3" />{d.kind === 'RELEASE_LETTER' ? 'Release letter' : d.filename}</button></li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
