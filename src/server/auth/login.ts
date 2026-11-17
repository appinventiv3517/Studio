import 'server-only';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import QRCode from 'qrcode';
import { headers } from 'next/headers';
import { db } from '@/server/db';
import { ActionError, endOtherSessions, endSession, lookupUser, readToken, signFor, startSession, TOKEN_MAX_AGE } from './session';
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

// 'rebind' is for pairing a new authenticator from the account page while signed in; it can never start a session.
type Challenge = { u: string; k: 'verify' | 'setup' | 'rebind'; x?: string; e: number };

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
    return typeof c.u === 'string' && (c.k === 'verify' || c.k === 'setup' || c.k === 'rebind') && c.e > Date.now() ? c : null;
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
  if (!c || c.k === 'rebind') throw new ActionError('That sign-in has expired. Enter your password again.', 400);
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
    const saved = await db.user.updateMany({ where: { id: user.id, OR: [{ twoFactorSecret: null }, { twoFactorSecret: { isSet: false } }] }, data: { twoFactorSecret: c.x!, twoFactorLastStep: step } });
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

/** Whether two-factor sign-in is set up for the signed-in person. */
export async function twoFactorStatus() {
  const me = await lookupUser();
  if (!me) throw new ActionError('Your session has ended. Sign in again.', 401);
  const u = await db.user.findUniqueOrThrow({ where: { id: me.id }, select: { twoFactorSecret: true } });
  return { enabled: !!u.twoFactorSecret };
}

/**
 * From the account page: starts pairing a (new) authenticator app. Needs the current password, because a
 * stolen session must not be able to swap the second factor. Returns a QR code and key; nothing changes until
 * finishAuthenticatorSetup gets a right code.
 */
export async function beginAuthenticatorSetup(password: string) {
  const me = await lookupUser();
  if (!me) throw new ActionError('Your session has ended. Sign in again.', 401);
  const key = `e:${me.email.toLowerCase()}`;
  const wait = tally(key, MAX_PER_EMAIL);
  if (wait) throw new ActionError(`Too many wrong attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);
  const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
    tally(key, MAX_PER_EMAIL, true);
    throw new ActionError('Your current password is not right.', 400);
  }
  const secret = newSecret();
  const issuer = (await db.settings.findUnique({ where: { id: 1 }, select: { name: true } }))?.name || 'Salon Studio';
  const qr = await QRCode.toDataURL(otpauthUri(secret, user.email, issuer), { margin: 1, width: 220 });
  return { challenge: makeChallenge({ u: user.id, k: 'rebind', x: secret, e: Date.now() + CHALLENGE_MS }), secret, qr };
}

/** Finishes pairing: a right code from the new app makes it the one used at sign-in. Other sessions are signed out. */
export async function finishAuthenticatorSetup(challenge: string, code: string) {
  const me = await lookupUser();
  if (!me) throw new ActionError('Your session has ended. Sign in again.', 401);
  const c = readChallenge(challenge);
  if (!c || c.k !== 'rebind' || c.u !== me.id || !c.x) throw new ActionError('That setup has expired. Start again.', 400);
  const text = code.trim();
  if (!text) throw new ActionError('Enter the code from your authenticator app.');
  const key = `o:${me.id}`;
  const wait = tally(key, MAX_CODES);
  if (wait) throw new ActionError(`Too many wrong codes. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);
  const step = matchCode(c.x, text);
  if (step === null) {
    tally(key, MAX_CODES, true);
    throw new ActionError('That code is not right. Check the code in your app and try again.', 401);
  }
  failures.delete(key);
  await db.user.update({ where: { id: me.id }, data: { twoFactorSecret: c.x, twoFactorLastStep: step } });
  await endOtherSessions(me.id, readToken()?.sessionId);
}
