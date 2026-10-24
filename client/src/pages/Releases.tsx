import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/context';
import type { Release } from '../lib/types';
import { Card, Empty, PageHeader, Spinner, Tabs } from '../components/ui';
import { ReleaseTable } from './Desk';

type Tab = 'mine' | 'open' | 'Released' | 'Rejected' | 'all';

export default function Releases() {
  const { user } = useAuth();
  const inst = user?.role === 'institution';
  const [tab, setTab] = useState<Tab>(inst ? 'all' : 'mine');
  const { data } = useQuery({ queryKey: ['releases', 'all'], queryFn: () => api<Release[]>('/releases') });
  const { data: mine } = useQuery({ queryKey: ['releases', 'mine'], queryFn: () => api<Release[]>('/releases?status=mine') });
  const OPEN = ['Submitted', 'Recommended', 'Forwarded', 'Approved', 'Returned'];
  const rows = tab === 'mine' ? mine : data?.filter((r) => tab === 'all' || (tab === 'open' ? OPEN.includes(r.status) : r.status === tab));
  return (
    <div>
      <PageHeader title={inst ? 'Release requests' : 'Release & refund'} subtitle="Requests to release, discharge or refund a deposit: officer scrutiny → Director → Competent Authority → Accounts" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        ...(inst ? [] : [{ value: 'mine' as Tab, label: 'Waiting on me', count: mine?.length }]),
        { value: 'open', label: inst ? 'In progress' : 'All open', count: data?.filter((r) => OPEN.includes(r.status)).length },
        { value: 'Released', label: 'Released', count: data?.filter((r) => r.status === 'Released').length },
        { value: 'Rejected', label: 'Rejected', count: data?.filter((r) => r.status === 'Rejected').length },
        { value: 'all', label: 'All', count: data?.length },
      ]} />
      <Card bodyClass="p-0">{!rows ? <Spinner /> : !rows.length ? <Empty title="No release requests here" /> : <ReleaseTable rows={rows.slice(0, 300)} />}</Card>
    </div>
  );
}
