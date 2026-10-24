import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FilePlus2, Mail, MessageSquareReply, RefreshCw, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useLookups } from '../lib/context';
import { fmtDate, fmtDateTime, inr, inrShort } from '../lib/format';
import type { Institution, InstrumentRow, Release } from '../lib/types';
import { Button, Card, ErrorBox, Spinner } from '../components/ui';
import { InstrumentTable, SectionNo } from '../components/kit';
import { ReleaseTable } from './Desk';

export interface InstitutionData extends Institution {
  region: { name: string; office: string } | null;
  instruments: InstrumentRow[];
  compliance: Array<{ purpose: string; required: number; held: number; holdUntil: string; complete: boolean; lapsed: number }>;
  outbox: Array<{ id: number; at: string; channel: string; kind: string; subject: string; body: string; to_addr: string }>;
  releases: Release[];
}

export default function InstitutionHome() {
  const { user } = useAuth();
  const { purposeName } = useLookups();
  const { data, error, isLoading } = useQuery({ queryKey: ['institution', user?.institution_id], queryFn: () => api<InstitutionData>(`/institutions/${user?.institution_id}`) });
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Spinner />;
  const held = data.instruments.filter((x) => ['Active', 'Matured', 'Release Requested'].includes(x.status));
  const todo: Array<{ icon: React.ReactNode; tone: string; title: string; body: string; to: string; cta: string }> = [];
  for (const x of data.instruments) {
    if (x.status === 'Query Raised') todo.push({ icon: <MessageSquareReply className="size-4" />, tone: 'warning', title: `Reply to AICTE's query on ${x.ref_no}`, body: `${x.type} ${x.instrument_no}`, to: `/instruments/${x.id}`, cta: 'Reply' });
    if (x.validity === 'lapsed') todo.push({ icon: <AlertTriangle className="size-4" />, tone: 'critical', title: `Renewal overdue: ${x.ref_no}`, body: `Matured ${fmtDate(x.maturity_date)}; must be held until ${fmtDate(x.hold_until)}`, to: `/submit?renew=${x.id}`, cta: 'Submit renewal' });
    if (x.validity === 'expiring') todo.push({ icon: <Clock className="size-4" />, tone: 'warning', title: `${x.ref_no} matures in ${x.days_left} days`, body: `Renew before ${fmtDate(x.maturity_date)}`, to: `/submit?renew=${x.id}`, cta: 'Submit renewal' });
    if ((x.validity === 'complete' && ['Active', 'Matured'].includes(x.status)) || (x.status === 'Renewed' && !data.releases.some((r) => r.instrument_id === x.id))) {
      todo.push({ icon: <Undo2 className="size-4" />, tone: 'info', title: `${x.ref_no} can be released`, body: x.status === 'Renewed' ? 'It has been replaced by a renewed instrument' : 'The holding period is over', to: `/instruments/${x.id}`, cta: 'Request release' });
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionNo n="01" label="Your institution" />
          <h1 className="mt-2 text-[24px] leading-tight sm:text-[28px]">{data.name}</h1>
          <p className="mt-1 text-sm text-ink-3">AICTE Permanent ID {data.aicte_id} · {data.city}, {data.state} · {data.trust_name}</p>
        </div>
        <Link to="/submit"><Button variant="primary"><FilePlus2 className="size-4" />Submit FDR</Button></Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="To do" subtitle="What AICTE needs from you">
          {!todo.length ? <p className="flex items-center gap-2 text-sm text-good-text"><CheckCircle2 className="size-4" />Nothing pending. All deposits are in order.</p> : (
            <ul className="space-y-2">
              {todo.map((t) => (
                <li key={t.title} className="flex items-center gap-3 rounded-[16px] border border-[var(--hairline)] p-3">
                  <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full', { critical: 'bg-critical-soft text-critical-text', warning: 'bg-warning-soft text-warning-text', info: 'bg-info-soft text-info-text' }[t.tone])}>{t.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t.title}</span><span className="block text-xs text-ink-3">{t.body}</span></span>
                  <Link to={t.to}><Button size="sm">{t.cta}</Button></Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Deposit requirements" subtitle="What you hold against what AICTE requires">
          <ul className="space-y-4">
            {data.compliance.map((c) => {
              const pct = c.required ? Math.min(100, (c.held / c.required) * 100) : 100;
              const ok = c.held >= c.required && !c.lapsed;
              return (
                <li key={c.purpose}>
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span>{purposeName(c.purpose)}</span><span className={clsx('tnum text-xs', ok ? 'text-good-text' : 'text-critical-text')}>{inrShort(c.held)} / {inrShort(c.required)}</span></div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', ok ? 'bg-good' : 'bg-critical')} style={{ width: `${pct}%` }} /></div>
                  <div className="mt-1 text-xs text-ink-3">{c.complete ? `Holding period ended ${fmtDate(c.holdUntil)}` : `Hold until ${fmtDate(c.holdUntil)}`}{c.lapsed ? ` · ${c.lapsed} lapsed` : ''}</div>
                </li>
              );
            })}
            {!data.compliance.length && <li className="text-sm text-ink-3">No deposits on record.</li>}
          </ul>
          <div className="mt-4 border-t border-hairline pt-3 text-sm">Held by AICTE: <b className="tnum">{inr(held.reduce((s, x) => s + x.amount, 0))}</b> in {held.length} instrument{held.length === 1 ? '' : 's'}</div>
        </Card>
      </div>

      <Card title="Your deposits" bodyClass="p-0" actions={<Link to="/instruments" className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink">Open register <ArrowRight className="size-3.5" /></Link>}>
        <InstrumentTable rows={data.instruments.filter((x) => x.status !== 'Rejected').slice(0, 12)} showInstitution={false} compact />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {!!data.releases.length && <Card title="Release requests" bodyClass="p-0"><ReleaseTable rows={data.releases.slice(0, 6)} /></Card>}
        <Card title="Messages from the portal" subtitle="E-mail and SMS sent to you automatically">
          <ul className="space-y-3">
            {data.outbox.slice(0, 8).map((o) => (
              <li key={o.id} className="flex gap-3">
                <span className="mt-0.5 text-ink-3">{o.kind === 'REMINDER' || o.kind === 'OVERDUE' ? <RefreshCw className="size-4" /> : <Mail className="size-4" />}</span>
                <span className="min-w-0"><span className="block text-sm">{o.subject}</span><span className="block text-xs text-ink-3">{fmtDateTime(o.at)} · {o.channel === 'sms' ? 'SMS' : o.to_addr}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
