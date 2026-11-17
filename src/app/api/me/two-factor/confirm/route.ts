import { route } from '@/app/api/_lib/handler';
import { attempt } from '@/server/api/attempt';
import { finishAuthenticatorSetup } from '@/server/auth/login';

export const dynamic = 'force-dynamic';

// POST { challenge, code }: a right code from the new authenticator app makes it the one used at sign-in.
export const POST = route(({ b }) => attempt(() => finishAuthenticatorSetup(String(b.challenge ?? ''), String(b.code ?? ''))));
