// Authenticator-app codes (RFC 6238): 6 digits that change every 30 seconds, from a shared secret.
// Works with Google Authenticator, Microsoft Authenticator, Authy, 1Password and similar apps.
import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SECONDS = 30;

/** A new random secret, as the base32 text authenticator apps expect. */
export function newSecret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g)!.map((c) => ALPHABET[parseInt(c, 2)]).join('');
}

function fromBase32(text: string) {
  let bits = '';
  for (const ch of text) bits += ALPHABET.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / SECONDS);

export function codeAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** The 30-second step this code belongs to, or null if it is wrong. The step before and after are accepted too, for clocks that drift. */
export function matchCode(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  for (const step of [stepAt(now), stepAt(now) - 1, stepAt(now) + 1]) {
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), given)) return step;
  }
  return null;
}

/** What the QR code holds: the address authenticator apps read to add the account. */
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${SECONDS}`;
