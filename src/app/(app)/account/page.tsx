import { currentUser } from '@/server/auth/session';
import { redirect } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
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
      <div className="grid max-w-4xl items-start gap-6 lg:grid-cols-2">
        <Card title="Change password"><PasswordForm /></Card>
        <Card title="Two-factor sign-in" subtitle="Authenticator app" actions={<Badge tone={enabled ? 'green' : 'amber'}>{enabled ? 'On' : 'Not set up'}</Badge>}>
          <TwoFactor enabled={enabled} />
        </Card>
      </div>
    </>
  );
}
