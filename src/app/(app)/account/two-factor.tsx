'use client';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { useAction } from '@/client/use-action';
import { beginAuthenticator, confirmAuthenticator, type AuthenticatorSetup } from '@/client/api/auth';

/** Shows whether the authenticator app is set up, and pairs a new one: password, then scan the QR code, then a code. */
export function TwoFactor({ enabled }: { enabled: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [code, setCode] = useState('');
  const close = () => { setOpen(false); setSetup(null); setPassword(''); setCode(''); };

  return (
    <div className="space-y-4">
      {!open && (
        <p className="text-[13.5px] leading-relaxed text-ink-soft">
          {enabled ? 'Every sign-in asks for a 6-digit code from your authenticator app. Got a new phone? Scan a new one here.' : 'Not set up yet. You will be asked to set it up the next time you sign in.'}
        </p>
      )}
      {!open && <Button variant="secondary" onClick={() => setOpen(true)}>{enabled ? 'Scan a new authenticator' : 'Set up authenticator'}</Button>}

      {open && !setup && (
        <form className="space-y-4" autoComplete="off" onSubmit={async (e) => {
          e.preventDefault();
          const res = await run(() => beginAuthenticator(password));
          if (res) setSetup(res);
        }}>
          <Field label="Current password" hint="Needed before the authenticator can be changed"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>Show QR code</Button>
            <Button variant="ghost" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}

      {open && setup && (
        <form className="space-y-4" autoComplete="off" onSubmit={async (e) => {
          e.preventDefault();
          if ((await run(() => confirmAuthenticator(setup.challenge, code), 'Authenticator updated. Other devices were signed out.')) !== false) close();
        }}>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-ink-soft marker:font-semibold marker:text-ink">
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li>
            <li>Scan the QR code, or type the key into the app.</li>
            <li>Enter the 6-digit code it shows. Until you do, the old authenticator keeps working.</li>
          </ol>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for the authenticator app" width={176} height={176} className="rounded-lg border border-line bg-white p-1" />
            <code className="max-w-full break-all rounded-md bg-white px-3 py-1.5 text-center font-mono text-[13px] tracking-wider text-ink ring-1 ring-inset ring-line">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
          </div>
          <Field label="Code"><Input id="otp-code" name="otp-code" type="text" autoComplete="off" data-lpignore="true" data-1p-ignore placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>Turn on</Button>
            <Button variant="ghost" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
