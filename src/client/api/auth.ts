import { call } from '@/client/api/call';

// Signing in takes two calls: the password, then the code from the authenticator app.
export type SignInStep =
  | { step: 'verify'; challenge: string }
  | { step: 'setup'; challenge: string; secret: string; qr: string };
export type SignedIn = { token: string; expiresIn: number; backupCodes?: string[] };

export const signIn = (email: string, password: string) => call<SignInStep>('POST', '/auth/login', { email, password });
export const verifyCode = (challenge: string, code: string) => call<SignedIn>('POST', '/auth/verify-otp', { challenge, code });
