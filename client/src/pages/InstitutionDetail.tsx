import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { FilePlus2, Mail, MessageSquare } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useLookups } from '../lib/context';
import { fmtDate, fmtDateTime, inr, inrShort } from '../lib/format';
import { Button, Card, ErrorBox, KeyVal, PageHeader, Spinner, ToneBadge } from '../components/ui';
import { InstrumentTable } from '../components/kit';
import { ReleaseTable } from './Desk';
import type { InstitutionData } from './InstitutionHome';

export default function InstitutionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { purposeName, regionName } = useLookups();
  const { data: d, error, isLoading } = useQuery({ queryKey: ['institution', Number(id)], queryFn: () => api<InstitutionData>(`/institutions/${id}`) });
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !d) return <Spinner />;
  const held = d.instruments.filter((x) => ['Active', 'Matured', 'Release Requested'].includes(x.status));
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Institutions', to: '/institutions' }, { label: d.aicte_id }]} title={d.name} subtitle={`${d.aicte_id} · ${d.city}, ${d.state} · ${regionName(d.region_code)}`}
        actions={['officer', 'head', 'admin'].includes(user?.role ?? '') ? <Link to="/submit"><Button><FilePlus2 className="size-4" />Record deposit</Button></Link> : undefined} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="Requirement vs holdings">
            <div className="grid gap-4 sm:grid-cols-2">
              {d.compliance.map((c) => {
                const ok = c.held >= c.required && !c.lapsed;
                return (
                  <div key={c.purpose} className="tile rounded-[16px] p-3">
                    <div className="text-sm">{purposeName(c.purpose)}</div>
                    <div className={clsx('mt-1 text-lg font-semibold tnum', ok ? 'text-good-text' : 'text-critical-text')}>{inrShort(c.held)} <span className="text-sm font-normal text-ink-3">of {inrShort(c.required)}</span></div>
                    <div className="text-xs text-ink-3">{c.complete ? `Holding period ended ${fmtDate(c.holdUntil)}` : `Hold until ${fmtDate(c.holdUntil)}`}{c.lapsed ? ` · ${c.lapsed} lapsed` : ''}</div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title={`Instruments (${d.instruments.length})`} bodyClass="p-0"><InstrumentTable rows={d.instruments} showInstitution={false} compact /></Card>
          {!!d.releases.length && <Card title="Release requests" bodyClass="p-0"><ReleaseTable rows={d.releases} /></Card>}
        </div>
        <aside className="space-y-5">
          <Card title="Profile">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <KeyVal label="Type">{d.type}</KeyVal><KeyVal label="Ownership">{d.ownership}</KeyVal>
              <KeyVal label="Trust / Society">{d.trust_name}</KeyVal><KeyVal label="Established">{d.established}</KeyVal>
              <KeyVal label="Head">{d.head_name}</KeyVal><KeyVal label="Approval">{d.approval_status}</KeyVal>
              <KeyVal label="E-mail">{d.email}</KeyVal><KeyVal label="Phone">{d.phone}</KeyVal>
              <KeyVal label="Held now">{inr(held.reduce((s, x) => s + x.amount, 0))}</KeyVal>
              <KeyVal label="Dues to AICTE">{d.dues_outstanding ? <span className="text-critical-text">{inr(d.dues_outstanding)}</span> : 'None'}</KeyVal>
            </dl>
            {!!d.open_cases && <div className="mt-3"><ToneBadge tone="warning" icon={<MessageSquare className="size-3.5" />}>{d.open_cases} open complaint case(s) in ICMS: release is blocked</ToneBadge></div>}
          </Card>
          <Card title="Notifications sent" subtitle="Automatic e-mail and SMS to the institution">
            <ul className="max-h-[480px] space-y-3 overflow-auto">
              {d.outbox.map((o) => (
                <li key={o.id} className="flex gap-2.5"><Mail className="mt-0.5 size-4 shrink-0 text-ink-3" /><span className="min-w-0"><span className="block text-sm">{o.subject}</span><span className="text-xs text-ink-3">{fmtDateTime(o.at)} · {o.channel === 'sms' ? 'SMS' : 'e-mail'}</span></span></li>
              ))}
              {!d.outbox.length && <li className="text-sm text-ink-3">None yet.</li>}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
