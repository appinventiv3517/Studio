// Lost your phone? Run `npm run reset-2fa` on the computer that runs the app.
// It turns two-factor sign-in off for the owner, so the next sign-in sets it up again with a new QR code.
// Pass an email to reset a different owner login: `npm run reset-2fa -- someone@example.com`.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const r = await db.user.updateMany({
    where: { role: 'Owner', ...(email && { email }) },
    data: { twoFactorSecret: null, twoFactorLastStep: 0 },
  });
  await db.session.deleteMany({ where: { user: { role: 'Owner', ...(email && { email }) } } });
  console.log(r.count ? `Two-factor sign-in reset for ${r.count} owner login${r.count > 1 ? 's' : ''}. Sign in again to set it up.` : 'No owner login found.');
}

main().finally(() => db.$disconnect());
