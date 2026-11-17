import 'server-only';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import QRCode from 'qrcode';
import { headers } from 'next/headers';
import { db } from '@/server/db';
import { ActionError, endSession, signFor, startSession, TOKEN_MAX_AGE } from './session';
import { matchCode, newSecret, otpauthUri } from './totp';

// Wrong-password limits. Failures are counted per email and per address for 15 minutes; the counts live in memory,
// so they reset when the app restarts.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 5;
const MAX_PER_ADDRESS = 20;
const MAX_CODES = 5; // wrong authenticator codes per person in that time
const CHALLENGE_MS = 5 * 60 * 1000; // time allowed between the password and the code
const failures = new Map<string, { count: number; since: number }>();

function tally(key: string, max: number, add = false) {
  const now = Date.now();
  let f = failures.get(key);
  if (!f || now - f.since > WINDOW_MS) {
    if (!add) return 0;
    f = { count: 0, since: now };
  }
  if (add) f.count++;
  failures.set(key, f);
  return f.count >= max ? Math.ceil((f.since + WINDOW_MS - now) / 60000) : 0;
}

function address() {
  const h = headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'local').trim();
}

type Challenge = { u: string; k: 'verify' | 'setup'; x?: string; e: number };

/** Proof that the password was right, valid for five minutes. For first-time setup it also carries the new secret. */
function makeChallenge(c: Challenge) {
  const payload = Buffer.from(JSON.stringify(c)).toString('base64url');
  return `${payload}.${signFor('2fa', payload)}`;
}

function readChallenge(token: string): Challenge | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(signFor('2fa', payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Challenge;
    return typeof c.u === 'string' && (c.k === 'verify' || c.k === 'setup') && c.e > Date.now() ? c : null;
  } catch {
    return null;
  }
}

/**
 * Step one of signing in: checks the email and password. No session starts yet. The owner must still give a
 * code from the authenticator app (step two, verifyCode). The first time, the answer carries a QR code to set the app up.
 */
export async function login(email: string, password: string) {
  const e = email.trim().toLowerCase();
  if (!e || !password) throw new ActionError('Enter your email and password.');
  const ip = address();
  const wait = Math.max(tally(`e:${e}`, MAX_PER_EMAIL), tally(`a:${ip}`, MAX_PER_ADDRESS));
  if (wait) throw new ActionError(`Too many wrong attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);

  const user = await db.user.findUnique({ where: { email: e } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    tally(`e:${e}`, MAX_PER_EMAIL, true);
    tally(`a:${ip}`, MAX_PER_ADDRESS, true);
    throw new ActionError('That email and password do not match.', 401);
  }
  if (user.role !== 'Owner') throw new ActionError('Only the owner can sign in.', 403);
  if (!user.active) throw new ActionError('This login has been switched off. Ask the owner to turn it back on.', 403);
  failures.delete(`e:${e}`);

  const expires = Date.now() + CHALLENGE_MS;
  if (user.twoFactorSecret) return { step: 'verify' as const, challenge: makeChallenge({ u: user.id, k: 'verify', e: expires }) };

  const secret = newSecret();
  const issuer = (await db.settings.findUnique({ where: { id: 1 }, select: { name: true } }))?.name || 'Salon Studio';
  const qr = await QRCode.toDataURL(otpauthUri(secret, user.email, issuer), { margin: 1, width: 220 });
  return { step: 'setup' as const, challenge: makeChallenge({ u: user.id, k: 'setup', x: secret, e: expires }), secret, qr };
}

/** Step two: checks the 6-digit code from the authenticator app, then starts the session. */
export async function verifyCode(challenge: string, code: string) {
  const c = readChallenge(challenge);
  if (!c) throw new ActionError('That sign-in has expired. Enter your password again.', 400);
  const text = code.trim();
  if (!text) throw new ActionError('Enter the code from your authenticator app.');
  const key = `o:${c.u}`;
  const wait = tally(key, MAX_CODES);
  if (wait) throw new ActionError(`Too many wrong codes. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);

  const user = await db.user.findUnique({ where: { id: c.u } });
  if (!user || user.role !== 'Owner' || !user.active) throw new ActionError('This login cannot sign in.', 403);
  const wrong = () => { tally(key, MAX_CODES, true); return new ActionError('That code is not right. Check the code in your app and try again.', 401); };

  if (c.k === 'setup') {
    if (user.twoFactorSecret) throw new ActionError('Two-factor sign-in is already set up. Enter your password again.', 400);
    const step = matchCode(c.x!, text);
    if (step === null) throw wrong();
    // Only the first finished setup counts, so two browsers cannot both claim the secret.
    const saved = await db.user.updateMany({ where: { id: user.id, twoFactorSecret: null }, data: { twoFactorSecret: c.x!, twoFactorLastStep: step } });
    if (!saved.count) throw new ActionError('Two-factor sign-in is already set up. Enter your password again.', 400);
  } else {
    const step = user.twoFactorSecret ? matchCode(user.twoFactorSecret, text) : null;
    if (step === null) throw wrong();
    // A code works once: the step must be newer than the last one accepted.
    const used = await db.user.updateMany({ where: { id: user.id, twoFactorLastStep: { lt: step } }, data: { twoFactorLastStep: step } });
    if (!used.count) throw wrong();
  }

  failures.delete(key);
  const token = await startSession(user.id);
  return { token, expiresIn: TOKEN_MAX_AGE, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

export async function logout() {
  await endSession();
}
