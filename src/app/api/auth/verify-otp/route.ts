import { route } from '@/app/api/_lib/handler';
import { attempt } from '@/server/api/attempt';
import { verifyCode } from '@/server/auth/login';

export const dynamic = 'force-dynamic';

export const POST = route(({ b }) => attempt(() => verifyCode(String(b.challenge ?? ''), String(b.code ?? ''))));
