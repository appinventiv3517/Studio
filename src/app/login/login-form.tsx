'use client';
import { useState } from 'react';
import { saveSession } from '@/client/session';
import { signIn, verifyCode, type SignInStep, type SignedIn } from '@/client/api/auth';
import { Button, Field, Input } from '@/components/ui';

// Step 1: email and password. Step 2: the 6-digit code from the authenticator app (the first time, set the app up with a QR code).
export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<SignInStep | null>(null);
  const finish = (s: SignedIn) => { saveSession(s.token, s.expiresIn); window.location.assign('/dashboard'); };

  async function password(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await signIn(String(form.get('email')), String(form.get('password')));
    if (res.ok && res.data) setStep(res.data);
    else setError(res.ok ? 'Could not sign in. Try again.' : res.error);
    setPending(false);
  }

  async function code(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!step) return;
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await verifyCode(step.challenge, String(form.get('otp-code')));
    if (res.ok && res.data) return finish(res.data);
    setError(res.ok ? 'Could not sign in. Try again.' : res.error);
    setPending(false);
  }

  const errorBox = error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>;

  if (step) {
    return (
      <form onSubmit={code} autoComplete="off" className="space-y-4">
        {step.step === 'setup' ? (
          <>
            <h3 className="text-[18px] font-bold">Set up two-factor sign-in</h3>
            <ol className="list-decimal space-y-1 pl-5 text-[13.5px] text-ink-soft">
              <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li>
              <li>Scan this QR code, or type the key below into the app.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.qr} alt="QR code for the authenticator app" width={180} height={180} className="rounded-lg border border-line" />
              <code className="break-all text-center text-[13px] tracking-wider">{step.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-[18px] font-bold">Enter your code</h3>
            <p className="text-[13.5px] text-ink-soft">Open your authenticator app and type the 6-digit code. Lost your phone? Ask whoever runs the app to reset two-factor sign-in.</p>
          </>
        )}
        <Field label="Code"><Input key={step.challenge} id="otp-code" name="otp-code" type="text" inputMode="text" autoComplete="off" data-lpignore="true" data-1p-ignore placeholder="6-digit code" required autoFocus /></Field>
        {errorBox}
        <Button type="submit" disabled={pending} className="w-full">{pending ? 'Checking…' : step.step === 'setup' ? 'Turn on and sign in' : 'Verify and sign in'}</Button>
        <Button variant="ghost" className="w-full" onClick={() => { setStep(null); setError(null); }}>Back</Button>
      </form>
    );
  }

  return (
    <form onSubmit={password} className="space-y-4">
      <Field label="Email"><Input id="email" name="email" type="email" autoComplete="username" required autoFocus /></Field>
      <Field label="Password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      {errorBox}
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Checking…' : 'Continue'}</Button>
    </form>
  );
}
