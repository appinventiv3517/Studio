import { route } from '@/app/api/_lib/handler';
import { attempt } from '@/server/api/attempt';
import { beginAuthenticatorSetup, twoFactorStatus } from '@/server/auth/login';

export const dynamic = 'force-dynamic';

// GET: is two-factor sign-in on? POST { password }: start pairing a new authenticator and get its QR code.
export const GET = route(() => attempt(() => twoFactorStatus()));
export const POST = route(({ b }) => attempt(() => beginAuthenticatorSetup(String(b.password ?? ''))));
