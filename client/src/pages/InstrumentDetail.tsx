import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertOctagon, AlertTriangle, ArrowRight, Ban, BadgeCheck, Check, CircleDashed, FileText, Landmark, MessageSquarePlus, MessageSquareReply, Minus, Pencil,
  RefreshCw, ScanText, ShieldCheck, StickyNote, Undo2, Upload, X,
} from 'lucide-react';
import { api, openDocument } from '../lib/api';
import { useAuth, useLookups, useToast } from '../lib/context';
import { bytes, fmtDate, fmtDateTime, inr, inrShort } from '../lib/format';
import { STATUS_COLOR } from '../lib/colors';
import type { Discrepancy, InstrumentDetail as Detail, Provenance } from '../lib/types';
import {
  BankBadge, Button, Card, ErrorBox, Field, Input, KeyVal, Modal, PageHeader, Select, SeverityBadge, Spinner, StatusBadge, Textarea, ToneBadge, ValidityBadge, VerificationBadge,
} from '../components/ui';
import { RULE_LABEL } from './Dashboard';

type ModalKind = null | 'verify' | 'query' | 'reject' | 'release' | 'edit' | 'upload' | 'note' | { waive: Discrepancy };

export default function InstrumentDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { push } = useToast();
  const { purposeName, bankName, typeName, docName } = useLookups();
  const [modal, setModal] = useState<ModalKind>(null);
  const { data: x, isLoading, error } = useQuery({ queryKey: ['instrument', id], queryFn: () => api<Detail>(`/instruments/${id}`) });
  const refresh = () => qc.invalidateQueries();
  const bankCheck = useMutation({
    mutationFn: () => api<{ status: string }>(`/instruments/${id}/bank-check`, { method: 'POST' }),
    onSuccess: (r) => { refresh(); push({ tone: r.status === 'confirmed' ? 'good' : r.status === 'unsupported' ? 'warning' : 'critical', title: r.status === 'confirmed' ? 'Bank confirmed all details' : r.status === 'unsupported' ? 'This bank is not connected; a confirmation letter is needed' : `Bank check: ${r.status.replace('_', ' ')}` }); },
    onError: (e) => push({ tone: 'critical', title: (e as Error).message }),
  });

  if (error) return <ErrorBox error={error} />;
  if (isLoading || !x) return <Spinner />;
  const p = x.permissions;
  const staff = user?.role !== 'institution';
  const openDisc = x.discrepancies.filter((d) => d.status === 'open');
  const blocking = openDisc.filter((d) => d.severity === 'critical' || d.severity === 'serious');
  const openQuery = x.queries.find((q) => q.status === 'open');
  const openRelease = x.releases.find((r) => !['Released', 'Rejected'].includes(r.status));

  return (
    <div>
      <PageHeader
        crumbs={[{ label: staff ? 'Register' : 'My deposits', to: '/instruments' }, { label: x.ref_no }]}
        title={<span className="flex flex-wrap items-center gap-x-3">{x.type} {x.instrument_no}</span>}
        subtitle={<>{staff ? <Link to={`/institutions/${x.institution_id}`} className="hover:underline">{x.institution_name}</Link> : x.institution_name} · {x.aicte_id} · {purposeName(x.purpose)}</>}
        actions={<>
          {p.bankCheck && <Button onClick={() => bankCheck.mutate()} loading={bankCheck.isPending}><Landmark className="size-4" />Check with bank</Button>}
          {p.query && <Button onClick={() => setModal('query')}><MessageSquarePlus className="size-4" />Raise query</Button>}
          {p.reject && <Button variant="ghost" onClick={() => setModal('reject')}><Ban className="size-4" />Reject</Button>}
          {p.verify && <Button variant="primary" onClick={() => setModal('verify')}><ShieldCheck className="size-4" />Accept</Button>}
          {p.renew && <Link to={`/submit?renew=${x.id}`}><Button variant={x.validity_state === 'lapsed' || x.validity_state === 'expiring' ? 'primary' : 'secondary'}><RefreshCw className="size-4" />Submit renewal</Button></Link>}
          {p.requestRelease && <Button onClick={() => setModal('release')}><Undo2 className="size-4" />Request release</Button>}
        </>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status={x.status} />
        <ValidityBadge state={x.validity_state} daysLeft={x.days_left} />
        <VerificationBadge mode={x.verification} />
        {x.type !== 'SD' && <BankBadge status={x.bank_status} />}
        {x.legacy ? <ToneBadge tone="muted">Migrated from manual register</ToneBadge> : null}
        {x.escalation_level > 0 && <ToneBadge tone="critical" icon={<AlertOctagon className="size-3.5" />}>Escalation level {x.escalation_level}</ToneBadge>}
      </div>

      <div className="space-y-3">
        {['encashed', 'not_found'].includes(x.bank_status) && !['Submitted', 'Under Scrutiny', 'Query Raised'].includes(x.status) && (
          <Banner tone="critical" icon={<Landmark className="size-5" />} title={x.bank_status === 'encashed' ? 'The bank reports this deposit was encashed before maturity' : 'The bank no longer has a record of this deposit'}>
            Found by the periodic re-check on {fmtDateTime(x.bank_checked_at)}. AICTE's security is no longer in place: issue a show-cause notice and demand a fresh instrument.
          </Banner>
        )}
        {x.validity_state === 'lapsed' && (
          <Banner tone="critical" icon={<AlertTriangle className="size-5" />} title={`Renewal overdue by ${-(x.days_left ?? 0)} days`}>
            Matured on {fmtDate(x.maturity_date)} but must be maintained until {fmtDate(x.hold_until)}. {staff ? 'Reminders and notices have been sent automatically; see the history below.' : 'Submit the renewed instrument immediately.'}
          </Banner>
        )}
        {x.validity_state === 'expiring' && (
          <Banner tone="warning" icon={<AlertTriangle className="size-5" />} title={`Matures in ${x.days_left} days — renewal required`}>
            The deposit must be held until {fmtDate(x.hold_until)}. {x.reminder_stage !== null ? `Last reminder: T-${x.reminder_stage}.` : ''}
          </Banner>
        )}
        {!!blocking.length && ['Submitted', 'Under Scrutiny', 'Query Raised'].includes(x.status) && (
          <Banner tone="serious" icon={<AlertOctagon className="size-5" />} title={`${blocking.length} blocking discrepanc${blocking.length === 1 ? 'y' : 'ies'}`}>
            This instrument cannot be accepted until they are resolved{p.waive ? ' or (if not critical) waived with reasons' : ''}.
          </Banner>
        )}
        {openQuery && (
          <Banner tone="warning" icon={<MessageSquareReply className="size-5" />} title={`Query from AICTE · reply by ${fmtDate(openQuery.due_on)}`}
            action={p.reply ? <Button variant="primary" size="sm" onClick={() => setModal('edit')}><MessageSquareReply className="size-4" />Reply</Button> : undefined}>
            {openQuery.text}
          </Banner>
        )}
        {openRelease && (
          <Banner tone="info" icon={<Undo2 className="size-5" />} title={`Release request ${openRelease.req_no}: ${openRelease.status}`} action={<Link to={`/releases/${openRelease.id}`}><Button size="sm">Open <ArrowRight className="size-4" /></Button></Link>}>
            {openRelease.checklist.filter((c) => !c.ok).length ? `${openRelease.checklist.filter((c) => !c.ok).length} condition(s) still to be met.` : 'All conditions met.'}
          </Banner>
        )}
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <ThreeWay x={x} />
          <Card title="Discrepancies" subtitle="Found automatically by the rule engine; re-checked on every change"
            actions={p.edit && !openQuery ? <Button size="sm" onClick={() => setModal('edit')}><Pencil className="size-3.5" />Correct details</Button> : undefined}>
            {!x.discrepancies.length ? <p className="text-sm text-ink-3">No discrepancies found.</p> : (
              <ul className="divide-y divide-[var(--hairline)]">
                {x.discrepancies.map((d) => (
                  <li key={d.id} className={clsx('flex flex-wrap items-start gap-3 py-3', d.status !== 'open' && 'opacity-60')}>
                    <SeverityBadge severity={d.severity} label={RULE_LABEL[d.rule] ?? d.rule} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{d.message}</p>
                      {d.action && d.status === 'open' && <p className="mt-0.5 text-xs text-ink-3">→ {d.action}</p>}
                      {d.status !== 'open' && <p className="mt-0.5 text-xs text-ink-3">{d.status === 'waived' ? `Waived by ${d.resolved_by_name}: ${d.note}` : `Resolved ${fmtDate(d.resolved_at)}${d.note ? ` · ${d.note}` : ''}`}</p>}
                    </div>
                    {d.status === 'open' && p.waive && d.severity !== 'critical' && <Button size="sm" variant="ghost" onClick={() => setModal({ waive: d })}>Waive</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {!!x.queries.length && (
            <Card title="Queries">
              <ul className="space-y-4">
                {x.queries.map((q) => (
                  <li key={q.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3"><span className="font-medium text-ink-2">{q.raised_by_name ?? 'AICTE'}</span>· {fmtDateTime(q.raised_at)} · reply due {fmtDate(q.due_on)}
                      <ToneBadge tone={q.status === 'open' ? 'warning' : 'good'}>{q.status}</ToneBadge></div>
                    <p className="mt-1 text-ink">{q.text}</p>
                    {q.response && <div className="mt-2 border-l-2 border-[var(--axis)] pl-3"><div className="text-xs text-ink-3">Reply · {fmtDateTime(q.responded_at)}</div><p className="text-ink-2">{q.response}</p></div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="History" subtitle="Every submission, check, reminder, decision and change, with who and when"
            actions={p.note ? <Button size="sm" variant="ghost" onClick={() => setModal('note')}><StickyNote className="size-3.5" />Add note</Button> : undefined}>
            <Timeline x={x} />
          </Card>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card title="Instrument">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <KeyVal label="Amount"><span className="tnum">{inr(x.amount)}</span></KeyVal>
              <KeyVal label="Required"><span className={clsx('tnum', x.required_amount && x.amount < x.required_amount && 'text-critical-text')}>{inr(x.required_amount)}</span></KeyVal>
              <KeyVal label="Type">{typeName(x.type)}</KeyVal>
              <KeyVal label="Bank">{bankName(x.bank_code)}</KeyVal>
              <KeyVal label="Branch">{x.branch}</KeyVal>
              <KeyVal label="IFSC">{x.ifsc}</KeyVal>
              <KeyVal label="Issued">{fmtDate(x.issue_date)}</KeyVal>
              <KeyVal label="Matures">{x.maturity_date ? fmtDate(x.maturity_date) : 'No maturity'}</KeyVal>
              <KeyVal label="Hold until">{fmtDate(x.hold_until)}</KeyVal>
              <KeyVal label="Interest">{x.interest_rate ? `${x.interest_rate}% p.a.` : '—'}{x.auto_renew ? ' · auto-renew' : ''}</KeyVal>
              <KeyVal label="Depositor">{x.depositor_name}</KeyVal>
              <KeyVal label="In favour of">{x.lien_in_favour}</KeyVal>
              <KeyVal label="Account">{x.account_masked ?? '—'}</KeyVal>
              <KeyVal label="Dealing officer">{x.officer_name ?? '—'}</KeyVal>
              <KeyVal label="Submitted">{fmtDateTime(x.submitted_at)}</KeyVal>
              <KeyVal label="Verified">{x.verified_at ? <>{fmtDate(x.verified_at)}<div className="text-xs text-ink-3">{x.verified_by_name}</div></> : '—'}</KeyVal>
            </dl>
            {x.verify_note && <p className="mt-3 border-l-2 border-[var(--axis)] pl-3 text-xs text-ink-2">{x.verify_note}</p>}
          </Card>

          <Card title="Renewal history" subtitle="Each instrument held for this requirement, oldest first">
            <ol className="relative space-y-3 border-l border-[var(--axis)] pl-4">
              {x.lineage.map((l) => (
                <li key={l.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-[var(--panel)]" style={{ background: STATUS_COLOR[l.status] }} />
                  {l.id === x.id ? <div className="text-sm font-semibold">{l.ref_no} <span className="text-xs font-normal text-ink-3">(this)</span></div>
                    : <Link to={`/instruments/${l.id}`} className="text-sm font-medium text-accent-text hover:underline">{l.ref_no}</Link>}
                  <div className="text-xs text-ink-3">{fmtDate(l.issue_date)} → {l.maturity_date ? fmtDate(l.maturity_date) : '—'} · {inrShort(l.amount)} · {l.status}</div>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Documents" subtitle="Encrypted at rest; fingerprint (SHA-256) detects reuse and tampering"
            actions={p.upload ? <Button size="sm" variant="ghost" onClick={() => setModal('upload')}><Upload className="size-3.5" />Upload</Button> : undefined}>
            <ul className="space-y-2">
              {x.documents.map((d) => (
                <li key={d.id}>
                  <button className="-mx-2 flex w-full items-start gap-2.5 rounded-[12px] px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => openDocument(d.id).catch((e) => push({ tone: 'critical', title: (e as Error).message }))}>
                    <FileText className="mt-0.5 size-4 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{docName(d.kind)}</span>
                      <span className="block truncate text-[11px] text-ink-3">{d.filename} · {bytes(d.size)} · {fmtDate(d.uploaded_at)} · <span className="font-mono">{d.sha256.slice(0, 10)}</span></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {!!x.releases.length && (
            <Card title="Release requests">
              <ul className="space-y-2 text-sm">
                {x.releases.map((r) => (
                  <li key={r.id}><Link to={`/releases/${r.id}`} className="flex items-center justify-between gap-2 hover:underline"><span>{r.req_no}</span><span className="text-xs text-ink-3">{r.status} · {fmtDate(r.requested_at)}</span></Link></li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      {modal === 'verify' && <VerifyModal x={x} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'query' && <TextModal title="Raise a query to the institution" label="Query" placeholder="What must the institution explain, correct or upload?" initial={openDisc.map((d) => d.action ? `${d.message} ${d.action}` : d.message).join('\n')}
        extra={{ key: 'due_days', label: 'Reply within (days)', initial: '15' }} path={`/instruments/${x.id}/query`} field="text" onClose={() => setModal(null)} onDone={refresh} done="Query sent to the institution" />}
      {modal === 'reject' && <TextModal title="Reject this submission" label="Reason (sent to the institution)" path={`/instruments/${x.id}/reject`} field="note" danger onClose={() => setModal(null)} onDone={refresh} done="Submission rejected" />}
      {modal === 'note' && <TextModal title="Add a note" label="Note" path={`/instruments/${x.id}/note`} field="text" onClose={() => setModal(null)} onDone={refresh} done="Note added" />}
      {modal === 'release' && <ReleaseModal x={x} onClose={() => setModal(null)} />}
      {modal === 'edit' && <EditModal x={x} reply={!!openQuery && p.reply} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'upload' && <UploadModal x={x} onClose={() => setModal(null)} onDone={refresh} />}
      {modal && typeof modal === 'object' && 'waive' in modal && <TextModal title={`Waive: ${RULE_LABEL[modal.waive.rule] ?? modal.waive.rule}`} label="Why is this acceptable? (recorded in the audit trail)" path={`/discrepancies/${modal.waive.id}/waive`} field="note" onClose={() => setModal(null)} onDone={refresh} done="Discrepancy waived" />}
    </div>
  );
}

function Banner({ tone, icon, title, children, action }: { tone: 'critical' | 'serious' | 'warning' | 'info'; icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  const cls = { critical: 'border-critical/40 bg-critical-soft text-critical-text', serious: 'border-serious/40 bg-serious-soft text-serious-text', warning: 'border-warning/40 bg-warning-soft text-warning-text', info: 'border-info/40 bg-info-soft text-info-text' }[tone];
  return (
    <div className={clsx('flex flex-wrap items-start gap-3 rounded-[24px] border px-4 py-3', cls)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{title}</div>{children && <div className="mt-0.5 text-sm text-ink-2">{children}</div>}</div>
      {action}
    </div>
  );
}

const fmtVal = (field: string, v: Provenance['declared']) => {
  if (v === null || v === undefined || v === '') return null;
  if (field === 'amount') return inr(Number(v));
  if (field.endsWith('_date')) return fmtDate(String(v));
  return String(v);
};

/** The core idea: what the institution declared, what the document says, what the bank confirms. */
function ThreeWay({ x }: { x: Detail }) {
  const bankNote = x.type === 'SD' ? 'Online deposits are confirmed against the AICTE account statement by Accounts.'
    : x.bank ? `${x.bank.bank ?? 'Bank'} · checked ${fmtDateTime(x.bank.at)} · ref ${x.bank.ref}`
      : x.bank_status === 'unsupported' ? 'This bank is not connected to the verification service; a bank confirmation letter is required.' : 'Not yet checked with the bank.';
  return (
    <Card title="Three-way check" subtitle="Institution's declaration against the uploaded document and the bank's own record">
      <div className="mb-3 grid gap-2 text-xs text-ink-3 sm:grid-cols-2">
        <div className="flex items-start gap-1.5"><ScanText className="mt-0.5 size-3.5 shrink-0" />{x.doc?.source === 'pdf-text' ? 'Read automatically from the PDF text layer' : x.doc?.source === 'ocr' ? 'Read automatically by OCR from the scan' : x.doc?.source === 'migrated' ? 'Migrated record: document not machine-read' : 'Document could not be read automatically'}</div>
        <div className="flex items-start gap-1.5"><Landmark className="mt-0.5 size-3.5 shrink-0" />{bankNote}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead><tr className="border-b border-hairline text-left">
            <th className="py-2 pr-3 text-xs font-medium text-ink-3">Field</th>
            <th className="py-2 pr-3 text-xs font-medium text-ink-3">Declared by institution</th>
            <th className="py-2 pr-3 text-xs font-medium text-ink-3">Read from document</th>
            <th className="py-2 text-xs font-medium text-ink-3">Confirmed by bank</th>
          </tr></thead>
          <tbody>
            {x.provenance.map((r) => (
              <tr key={r.field} className="border-b border-hairline last:border-0">
                <td className="py-2 pr-3 text-xs text-ink-3">{r.label}</td>
                <td className="py-2 pr-3 tnum">{fmtVal(r.field, r.declared) ?? '—'}</td>
                <Cell value={fmtVal(r.field, r.document)} match={r.documentMatch} />
                <Cell value={fmtVal(r.field, r.bank)} match={r.bankMatch} bank />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
function Cell({ value, match, bank }: { value: string | null; match?: boolean; bank?: boolean }) {
  return (
    <td className={clsx('py-2 pr-3', match === false && (bank ? 'bg-critical-soft' : 'bg-warning-soft'))}>
      <span className="flex items-center gap-1.5">
        {match === true ? <Check className={clsx('size-3.5 shrink-0', bank ? 'text-good-text' : 'text-ink-3')} /> : match === false ? <X className={clsx('size-3.5 shrink-0', bank ? 'text-critical-text' : 'text-warning-text')} /> : value === null ? <Minus className="size-3.5 shrink-0 text-muted" /> : <CircleDashed className="size-3.5 shrink-0 text-muted" />}
        <span className={clsx('tnum', match === false ? 'font-medium text-ink' : value === null ? 'text-muted' : 'text-ink-2')}>{value ?? (bank ? 'not confirmed' : 'not found')}</span>
      </span>
    </td>
  );
}

function Timeline({ x }: { x: Detail }) {
  const { eventLabel } = useLookups();
  const icon = (t: string) => t === 'VERIFIED' ? <BadgeCheck className="size-3.5" /> : t.startsWith('BANK') || t === 'REVERIFIED' ? <Landmark className="size-3.5" /> : t === 'REMINDER_SENT' ? <MessageSquarePlus className="size-3.5" /> : t === 'ESCALATED' || t === 'REJECTED' ? <AlertOctagon className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />;
  const tone = (t: string) => ['ESCALATED', 'REJECTED', 'BANK_ALERT'].includes(t) ? 'text-critical-text bg-critical-soft' : t === 'VERIFIED' || t === 'RELEASED' ? 'text-good-text bg-good-soft' : t === 'REMINDER_SENT' || t === 'QUERY_RAISED' ? 'text-warning-text bg-warning-soft' : 'text-ink-2 bg-surface-2';
  return (
    <ol className="space-y-3">
      {[...x.events].reverse().map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className={clsx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', tone(e.type))}>{icon(e.type)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-medium">{eventLabel(e.type)}{e.to_status && e.from_status !== e.to_status && <span className="font-normal text-ink-3"> → {e.to_status}</span>}</span>
              <span className="text-xs text-ink-3" title={fmtDateTime(e.at)}>{fmtDateTime(e.at)}</span>
            </div>
            <div className="text-xs text-ink-3">{e.actor_name ? `${e.actor_name}${e.actor_designation ? `, ${e.actor_designation}` : ''}` : 'System'}</div>
            {e.remarks && <p className="mt-0.5 text-sm text-ink-2">{e.remarks}</p>}
            {e.type === 'FIELD_UPDATED' && e.data && (
              <ul className="mt-1 text-xs text-ink-3">{Object.entries(e.data as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => <li key={k}>{k.replace(/_/g, ' ')}: <s>{String(v.from ?? '—')}</s> → {String(v.to ?? '—')}</li>)}</ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------- modals ----------------
function useAct(onDone: () => void, onClose: () => void, done?: string) {
  const { push } = useToast();
  return useMutation({
    mutationFn: ({ path, body, form }: { path: string; body?: unknown; form?: FormData }) => api(path, { method: 'POST', body, form }),
    onSuccess: () => { onDone(); onClose(); if (done) push({ tone: 'good', title: done }); },
  });
}

function TextModal({ title, label, placeholder, path, field, onClose, onDone, done, danger, initial = '', extra }: {
  title: string; label: string; placeholder?: string; path: string; field: string; onClose: () => void; onDone: () => void; done?: string; danger?: boolean; initial?: string;
  extra?: { key: string; label: string; initial: string };
}) {
  const [text, setText] = useState(initial);
  const [ex, setEx] = useState(extra?.initial ?? '');
  const m = useAct(onDone, onClose, done);
  return (
    <Modal open onClose={onClose} title={title} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={m.isPending} onClick={() => m.mutate({ path, body: { [field]: text, ...(extra ? { [extra.key]: ex } : {}) } })}>Submit</Button>
    </>}>
      <div className="space-y-4">
        <Field label={label}><Textarea rows={5} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
        {extra && <Field label={extra.label}><Input type="number" min={3} max={60} value={ex} onChange={(e) => setEx(e.target.value)} className="w-28" /></Field>}
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function VerifyModal({ x, onClose, onDone }: { x: Detail; onClose: () => void; onDone: () => void }) {
  const hasLetter = x.documents.some((d) => d.kind === 'BANK_CONFIRMATION');
  const [mode, setMode] = useState(x.bank_status === 'confirmed' ? 'bank_api' : hasLetter ? 'bank_letter' : 'officer');
  const [note, setNote] = useState('');
  const m = useAct(onDone, onClose, 'Instrument accepted and taken on record');
  const opts = [
    { v: 'bank_api', label: 'Confirmed by the bank online', ok: x.bank_status === 'confirmed', why: x.bank_status === 'confirmed' ? `Bank confirmed on ${fmtDateTime(x.bank_checked_at)}` : 'The bank has not confirmed it (check with bank first)' },
    { v: 'bank_letter', label: 'Confirmed by bank letter', ok: hasLetter, why: hasLetter ? 'A bank confirmation letter is on file' : 'Upload the bank confirmation letter first' },
    { v: 'officer', label: 'Accept without bank confirmation', ok: x.permissions.verifyWithoutBank, why: x.permissions.verifyWithoutBank ? 'Needs a recorded justification; shown as officer-verified everywhere' : 'Only the Director or the Competent Authority can do this' },
  ];
  return (
    <Modal open onClose={onClose} title={`Accept ${x.ref_no}`} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={m.isPending} onClick={() => m.mutate({ path: `/instruments/${x.id}/verify`, body: { mode, note } })}><ShieldCheck className="size-4" />Accept</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">How were the details confirmed? The answer is recorded and shown with the instrument, so bank-confirmed and declared-only records are never confused.</p>
        {opts.map((o) => (
          <label key={o.v} className={clsx('flex cursor-pointer gap-3 rounded-[16px] border p-3', mode === o.v ? 'border-ink' : 'border-[var(--hairline)]', !o.ok && 'cursor-not-allowed opacity-50')}>
            <input type="radio" name="mode" disabled={!o.ok} checked={mode === o.v} onChange={() => setMode(o.v)} className="mt-1" />
            <span><span className="block text-sm font-medium">{o.label}</span><span className="text-xs text-ink-3">{o.why}</span></span>
          </label>
        ))}
        <Field label={mode === 'officer' ? 'Justification (required)' : 'Remarks (optional)'}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function ReleaseModal({ x, onClose }: { x: Detail; onClose: () => void }) {
  const { meta } = useLookups();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [reason, setReason] = useState(x.status === 'Renewed' ? 'REPLACED' : 'HOLD_COMPLETE');
  const [details, setDetails] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => { const f = new FormData(); f.append('reason', reason); f.append('details', details); if (file) f.append('NO_DUES', file); return api<{ id: number }>(`/instruments/${x.id}/release`, { method: 'POST', form: f }); },
    onSuccess: (r) => { qc.invalidateQueries(); nav(`/releases/${r.id}`); },
  });
  return (
    <Modal open onClose={onClose} title={`Request release of ${x.ref_no}`} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Submit request</Button>
    </>}>
      <div className="space-y-4">
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {meta?.releaseReasons.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label="Details"><Textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Anything the Regulation Bureau should know" /></Field>
        <Field label="No-dues certificate (optional)"><input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" /></Field>
        <p className="text-xs text-ink-3">The portal checks the conditions automatically (holding period, discrepancies, open ICMS cases, dues). The request then goes to the dealing officer, the Director and the Competent Authority, and Accounts issues the release letter.</p>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

const EDIT_FIELDS: Array<[string, string, string?]> = [['instrument_no', 'Instrument number'], ['amount', 'Amount (₹)', 'number'], ['issue_date', 'Date of issue', 'date'], ['maturity_date', 'Maturity / validity', 'date'],
  ['ifsc', 'IFSC'], ['branch', 'Branch'], ['depositor_name', 'Depositor'], ['lien_in_favour', 'In favour of']];
function EditModal({ x, reply, onClose, onDone }: { x: Detail; reply: boolean; onClose: () => void; onDone: () => void }) {
  const { user } = useAuth();
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(EDIT_FIELDS.map(([k]) => [k, String((x as unknown as Record<string, unknown>)[k] ?? '')])));
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState('QUERY_REPLY');
  const { meta } = useLookups();
  const m = useAct(onDone, onClose, reply ? 'Reply sent' : 'Details corrected');
  const changed = Object.fromEntries(Object.entries(vals).filter(([k, v]) => String((x as unknown as Record<string, unknown>)[k] ?? '') !== v));
  const submit = () => {
    if (reply) {
      const f = new FormData();
      f.append('response', text);
      if (Object.keys(changed).length) f.append('fields', JSON.stringify(changed));
      if (file) f.append(kind, file);
      m.mutate({ path: `/instruments/${x.id}/reply`, form: f });
    } else m.mutate({ path: `/instruments/${x.id}/fields`, body: { fields: changed, reason: text } });
  };
  return (
    <Modal wide open onClose={onClose} title={reply ? 'Reply to query' : 'Correct details'} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={m.isPending} onClick={submit}>{reply ? 'Send reply' : 'Save corrections'}</Button>
    </>}>
      <div className="space-y-4">
        <Field label={reply ? 'Your reply' : user?.role === 'institution' ? 'What was corrected' : 'Reason for correction (audited)'}><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {EDIT_FIELDS.filter(([k]) => k !== 'maturity_date' || x.maturity_date).map(([k, l, t]) => (
            <Field key={k} label={l}><Input type={t ?? 'text'} value={vals[k]} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} className={changed[k] !== undefined ? 'border-warning' : undefined} /></Field>
          ))}
        </div>
        {reply && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Attach document">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>{meta?.docKinds.filter((d) => d.code !== 'RELEASE_LETTER').map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</Select>
            </Field>
            <Field label="File"><input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-2 text-sm" /></Field>
          </div>
        )}
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function UploadModal({ x, onClose, onDone }: { x: Detail; onClose: () => void; onDone: () => void }) {
  const { meta } = useLookups();
  const [kind, setKind] = useState('BANK_CONFIRMATION');
  const [file, setFile] = useState<File | null>(null);
  const m = useAct(onDone, onClose, 'Document uploaded');
  return (
    <Modal open onClose={onClose} title="Upload a document" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!file} loading={m.isPending} onClick={() => { const f = new FormData(); f.append(kind, file!); m.mutate({ path: `/instruments/${x.id}/documents`, form: f }); }}>Upload</Button>
    </>}>
      <div className="space-y-4">
        <Field label="Document type"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{meta?.docKinds.filter((d) => d.code !== 'RELEASE_LETTER').map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</Select></Field>
        <Field label="File (PDF, PNG or JPEG, up to 10 MB)"><input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-2 text-sm" /></Field>
        <ErrorBox error={m.error} />
        <p className="text-xs text-ink-3">The file is encrypted before storage and its SHA-256 fingerprint is checked against every other document on record.</p>
      </div>
    </Modal>
  );
}
