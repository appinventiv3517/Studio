import { currentUser } from '@/server/auth/session';
import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { api } from '@/server/api/fetch';
import { PasswordForm } from './password-form';
import { TwoFactor } from './two-factor';

export default async function AccountPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  const { enabled } = await api<{ enabled: boolean }>('/me/two-factor');
  return (
    <>
      <PageHeader title="My Account" subtitle={`${me.name} · ${me.email} · ${me.role}`} />
      <Card title="Change password" className="max-w-md"><PasswordForm /></Card>
      <Card title="Two-factor sign-in" subtitle="Authenticator app" className="mt-6 max-w-md"><TwoFactor enabled={enabled} /></Card>
    </>
  );
}
