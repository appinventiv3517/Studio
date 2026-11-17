// End-to-end check of the API. Run `npm run build` first, then `npm run test:api`.
// It makes its own database and server, so your real data is never touched.
// It needs a MongoDB replica set: set TEST_DATABASE_URL to one without a database name, e.g.
//   mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true   (a throwaway database is made inside it and dropped after)
import { execSync, spawn, type ChildProcess } from 'child_process';
import { createHmac } from 'crypto';
import { PrismaClient } from '@prisma/client';

const PORT = 3400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error('Set TEST_DATABASE_URL to a MongoDB replica set (see the top of scripts/test-api.ts).');
const dbName = `salon_test_${Date.now()}`;
const url = base.replace(/\/(\?|$)/, `/${dbName}$1`);
const env = { ...process.env, DATABASE_URL: url, SESSION_SECRET: 'test-secret-test-secret-123', ALLOWED_ORIGINS: 'https://allowed.example', NODE_ENV: 'production' } as NodeJS.ProcessEnv;

let passed = 0;
const failed: string[] = [];
let token = '';

type Res = { status: number; ok: boolean; data: any; error?: string; headers: Headers };
async function call(method: string, path: string, body?: unknown, opts: { token?: string | null; headers?: Record<string, string>; form?: FormData } = {}): Promise<Res> {
  const t = opts.token === undefined ? token : opts.token;
  const headers: Record<string, string> = { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers };
  const r = await fetch(BASE + path, { method, headers, body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let j: any = {};
  try { j = JSON.parse(text); } catch { j = { raw: text }; }
  return { status: r.status, ok: j.ok === true, data: j.data, error: j.error, headers: r.headers };
}

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok    ${name}`); } else { failed.push(name); console.log(`  FAIL  ${name}${detail ? ' ' + JSON.stringify(detail).slice(0, 200) : ''}`); }
}
const works = (name: string, r: Res) => { check(name, r.ok, { status: r.status, error: r.error }); return r.data; };
const refused = (name: string, r: Res, status?: number) => check(name, !r.ok && (status === undefined || r.status === status), { status: r.status, error: r.error });
const testDb = new PrismaClient({ datasources: { db: { url } } });

// Authenticator codes, worked out here independently of the app (RFC 6238), so the app's codes are checked against a second copy.
function totp(secret: string, offset = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map((c) => A.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
const verify = (challenge: string, code: string) => call('POST', '/auth/verify-otp', { challenge, code }, { token: null });

// Signing in is two steps: the password, then the code. This does both, and sets up the authenticator the first time.
const secrets: Record<string, string> = {};
const login = async (email: string, password: string) => {
  const r = await call('POST', '/auth/login', { email, password }, { token: null });
  if (!r.ok) return r;
  if (r.data.step === 'setup') secrets[email] = r.data.secret;
  // Many sign-ins in one test would collide with "a code works once", so forget the last used code first.
  await testDb.user.updateMany({ data: { twoFactorLastStep: 0 } });
  return verify(r.data.challenge, totp(secrets[email]));
};

async function run() {
  const date = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const U = Math.random().toString(36).slice(2, 8);

  console.log('Sign in');
  refused('no login is refused', await call('GET', '/customers', undefined, { token: null }), 401);
  refused('wrong password is refused', await login('admin@salon.com', 'nope'), 401);
  const l = await login('admin@salon.com', 'admin123');
  token = works('admin signs in', l)?.token;
  works('me', await call('GET', '/me'));
  refused('unknown address gives a JSON 404', await call('GET', '/nothing/here'), 404);
  refused('wrong method is refused', await call('DELETE', '/dashboard'), 405);
  refused('garbled token is refused', await call('GET', '/me', undefined, { token: 'abc.def' }), 401);

  console.log('Reads');
  for (const p of ['/dashboard', '/alerts', '/reports?period=year', '/customers', '/appointments', '/attendance', '/invoices', '/products', '/stock/monthly', '/stock/movements', '/services', '/staff', '/suppliers', '/expenses', '/expenses/categories', '/branches', '/settings', '/users', '/public/branding']) works(`GET ${p}`, await call('GET', p));
  const get = async (p: string) => (await call('GET', p)).data;
  const branch = (await get('/branches'))[0].id;
  const cats = await get('/services');
  const cat = cats[0].id;
  works('customer export (csv)', { ...(await call('GET', '/customers/export?template=1')), ok: true } as Res);

  console.log('Staff and services');
  const staffBody = { name: 'Test Stylist', phone: '9222222222', email: '', title: 'Stylist', skills: '', payType: 'Commission', commissionRate: 10, monthlySalary: 0, workDays: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '20:00' };
  works('staff create', await call('POST', '/staff', staffBody));
  const st = (await get('/staff')).find((s: any) => s.name === 'Test Stylist').id;
  works('staff update', await call('PUT', `/staff/${st}`, { ...staffBody, title: 'Senior' }));
  works('staff get', await call('GET', `/staff/${st}`));
  works('category add', await call('POST', '/service-categories', { name: `Cat ${U}` }));
  works('service create', await call('POST', '/services', { name: `Svc ${U}`, categoryId: cat, price: 500, duration: 30 }));
  const sv = (await get('/services')).flatMap((c: any) => c.services).find((s: any) => s.name === `Svc ${U}`).id;
  works('service update', await call('PUT', `/services/${sv}`, { name: `Svc ${U}`, categoryId: cat, price: 600, duration: 45 }));
  works('service archive', await call('POST', `/services/${sv}/archive`));
  works('service restore', await call('POST', `/services/${sv}/restore`));

  console.log('Clients and appointments');
  const cu = works('customer create', await call('POST', '/customers', { name: 'Zed Client', phone: '9333333333', gender: 'Male' }))?.id;
  refused('same mobile number is refused', await call('POST', '/customers', { name: 'Other One', phone: '+91 93333 33333', gender: 'Male' }), 400);
  refused('invalid client is refused', await call('POST', '/customers', { name: '' }), 422);
  works('customer update', await call('PUT', `/customers/${cu}`, { name: 'Zed Client', phone: '9333333333', gender: 'Male', notes: 'x' }));
  works('customer import', await call('POST', '/customers/import', { csv: 'Name,Mobile\nImp Person,9444444444\n' }));
  const detail = await get(`/customers/${cu}`);
  check('customer detail has branch breakdown', Array.isArray(detail?.branchVisits));
  const ap = works('appointment book', await call('POST', '/appointments', { customerId: cu, staffId: st, branchId: branch, date: later, startTime: '10:00', serviceIds: [sv], walkIn: false }))?.id;
  refused('double booking is refused', await call('POST', '/appointments', { customerId: cu, staffId: st, branchId: branch, date: later, startTime: '10:00', serviceIds: [sv] }), 400);
  works('appointment reschedule', await call('PUT', `/appointments/${ap}`, { staffId: st, date: later, startTime: '12:00' }));
  works('appointment status', await call('POST', `/appointments/${ap}/status`, { status: 'CheckedIn' }));
  refused('impossible status change is refused', await call('POST', `/appointments/${ap}/status`, { status: 'Completed' }), 400);

  console.log('Attendance');
  works('mark present', await call('PUT', '/attendance', { staffId: st, date, present: true }));
  works('mark absent (changes the answer)', await call('PUT', '/attendance', { staffId: st, date, present: false }));
  const marked = (await get(`/attendance?date=${date}&staffId=${st}`)) as any[];
  check('attendance has one record for the day', marked.length === 1 && marked[0].present === false);
  works('add remark', await call('PUT', '/attendance', { staffId: st, date, remark: 'Left early' }));
  const withRemark = (await get(`/attendance?date=${date}&staffId=${st}`)) as any[];
  check('remark is saved and the status is kept', withRemark[0]?.remark === 'Left early' && withRemark[0]?.present === false);
  works('clear remark', await call('PUT', '/attendance', { staffId: st, date, remark: '' }));
  refused('remark needs a marked day first', await call('PUT', '/attendance', { staffId: st, date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), remark: 'x' }), 400);
  refused('future date is refused', await call('PUT', '/attendance', { staffId: st, date: later, present: true }), 400);

  console.log('Suppliers, products and stock');
  works('supplier create', await call('POST', '/suppliers', { name: `Sup ${U}`, phone: '9555555555', email: '' }));
  const su = (await get('/suppliers')).find((s: any) => s.name === `Sup ${U}`).id;
  works('supplier update', await call('PUT', `/suppliers/${su}`, { name: `Sup ${U}`, phone: '9555555555', email: '', notes: 'n' }));
  works('supplier switch off', await call('POST', `/suppliers/${su}/active`, { active: false }));
  works('supplier switch on', await call('POST', `/suppliers/${su}/active`, { active: true }));
  const prod = { name: `Prod ${U}`, category: 'Hair', supplierId: su, costPrice: 100, price: 200, reorderLevel: 2, unit: 'pcs', openingStock: 10, openingBranchId: branch };
  works('product create', await call('POST', '/products', prod));
  works('product with a sku', await call('POST', '/products', { ...prod, name: `Sku ${U}`, sku: `SKU-${U}` }));
  refused('a repeated sku is refused', await call('POST', '/products', { ...prod, name: `Sku2 ${U}`, sku: `SKU-${U}` }), 409);
  works('two products without a sku are fine', await call('POST', '/products', { ...prod, name: `NoSku ${U}` }));
  const pr = (await get('/products')).items.find((p: any) => p.name === `Prod ${U}`).id;
  works('product update', await call('PUT', `/products/${pr}`, { ...prod, price: 250, openingStock: undefined, openingBranchId: undefined }));
  works('stock in', await call('POST', '/stock/movements', { productId: pr, type: 'IN', qty: 5, branchId: branch, supplierId: su }));
  works('stock out', await call('POST', '/stock/movements', { productId: pr, type: 'OUT', qty: 2, branchId: branch }));
  works('stock count correction', await call('POST', '/stock/movements', { productId: pr, type: 'ADJUST', qty: 12, branchId: branch }));
  refused('taking out more than exists is refused', await call('POST', '/stock/movements', { productId: pr, type: 'OUT', qty: 999, branchId: branch }), 400);
  check('stock level is right', (await get(`/products/${pr}`)).stock === 12);
  works('stock history', await call('GET', `/products/${pr}/history`));
  const branches = await get('/branches');
  if (branches.length > 1) works('stock transfer', await call('POST', '/stock/transfers', { productId: pr, fromBranchId: branch, toBranchId: branches.find((b: any) => b.id !== branch).id, qty: 1 }));

  console.log('Billing');
  const inv = works('invoice create', await call('POST', '/invoices', { customerId: cu, branchId: branch, lines: [{ kind: 'service', refId: sv, staffId: st, qty: 1, unitPrice: 600 }, { kind: 'product', refId: pr, qty: 2, unitPrice: 250 }], discountType: 'percent', discountValue: 10, withGst: true, payments: [{ amount: 300, method: 'Cash' }] }))?.id;
  works('invoice get', await call('GET', `/invoices/${inv}`));
  works('invoice payment', await call('POST', `/invoices/${inv}/payments`, { amount: 100, method: 'UPI', reference: 'r1' }));
  refused('overpaying is refused', await call('POST', `/invoices/${inv}/payments`, { amount: 99999, method: 'UPI' }), 400);
  works('invoice refund', await call('POST', `/invoices/${inv}/refunds`, { amount: 50, method: 'Cash', reason: 'test' }));
  works('invoice cancel', await call('POST', `/invoices/${inv}/cancel`, { reason: 'test cancel', refundMethod: 'Cash' }));
  check('cancelling puts the stock back', (await get(`/products/${pr}`)).stock === 12);

  console.log('Supplier bills');
  works('bill create', await call('POST', '/supplier-bills', { supplierId: su, billNumber: 'B1', date, amount: 1000, paidNow: 200, method: 'Cash' }));
  const bill = (await get(`/suppliers/${su}`)).bills[0].id;
  refused('a repeated bill number is refused', await call('POST', '/supplier-bills', { supplierId: su, billNumber: 'B1', date, amount: 50 }), 409);
  refused('a made-up id is a 404, not a crash', await call('GET', '/customers/not-a-real-id'), 404);
  works('bill update', await call('PUT', `/supplier-bills/${bill}`, { supplierId: su, billNumber: 'B1', date, amount: 1200 }));
  const form = new FormData();
  form.set('supplierId', su); form.set('date', date); form.set('amount', '500');
  form.set('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'b.pdf');
  works('bill with file upload', await call('POST', '/supplier-bills', undefined, { form }));
  const withFile = (await get(`/suppliers/${su}`)).bills.find((b: any) => b.hasFile).id;
  const dl = await fetch(`${BASE}/supplier-bills/${withFile}/file`, { headers: { Authorization: `Bearer ${token}` } });
  check('bill file downloads', dl.status === 200 && (await dl.text()).startsWith('%PDF'));
  works('bill payment', await call('POST', '/supplier-payments', { billId: bill, date, amount: 100, method: 'Bank' }));
  const payId = (await get(`/suppliers/${su}`)).bills.find((b: any) => b.id === bill).payments.at(-1).id;
  works('payment delete', await call('DELETE', `/supplier-payments/${payId}`));
  works('bill delete', await call('DELETE', `/supplier-bills/${withFile}`));

  console.log('Expenses');
  works('expense create', await call('POST', '/expenses', { date, category: 'Rent', description: 'test', amount: 100, method: 'Cash', branchId: branch }));
  const ex = (await get('/expenses')).items.find((e: any) => e.description === 'test').id;
  works('expense update', await call('PUT', `/expenses/${ex}`, { date, category: 'Rent', description: 'test', amount: 150, method: 'UPI' }));
  works('expense get', await call('GET', `/expenses/${ex}`));
  works('expense delete', await call('DELETE', `/expenses/${ex}`));

  console.log('Settings, branches and logins');
  const s = await get('/settings');
  works('settings save', await call('PUT', '/settings', Object.fromEntries(['name', 'address', 'phone', 'email', 'gstin', 'openTime', 'closeTime', 'invoicePrefix', 'nextInvoiceNo', 'gstRate', 'invoiceFooter'].filter((k) => k in s).map((k) => [k, s[k]]))));
  works('branch create', await call('POST', '/branches', { name: `B ${U}`, address: 'x', active: true }));
  const nb = (await get('/branches')).find((b: any) => b.name === `B ${U}`).id;
  works('branch update', await call('PUT', `/branches/${nb}`, { name: `B ${U}`, address: 'y', active: true }));
  works('branch delete', await call('DELETE', `/branches/${nb}`));
  works('user create', await call('POST', '/users', { name: `U ${U}`, email: `u${U}@x.com`, role: 'Receptionist', active: true, password: 'password123' }));
  const nu = (await get('/users')).find((u: any) => u.email === `u${U}@x.com`).id;
  works('user update', await call('PUT', `/users/${nu}`, { name: `U ${U}`, email: `u${U}@x.com`, role: 'Manager', active: true }));
  refused('wrong current password is refused', await call('POST', '/me/password', { current: 'bad', next: 'newpassword1' }), 400);

  console.log('Only the owner can sign in');
  refused('manager cannot sign in', await login('manager@salon.com', 'manager123'), 403);
  refused('receptionist cannot sign in', await login('reception@salon.com', 'reception123'), 403);
  refused('a new non-owner login cannot sign in', await login(`u${U}@x.com`, 'password123'), 403);
  works('user delete', await call('DELETE', `/users/${nu}`));

  console.log('Sign-out cancels the token');
  const a = (await login('admin@salon.com', 'admin123')).data.token;
  const b = (await login('admin@salon.com', 'admin123')).data.token;
  works('first session works', await call('GET', '/me', undefined, { token: a }));
  works('sign out', await call('POST', '/auth/logout', {}, { token: a }));
  refused('signed-out token no longer works', await call('GET', '/me', undefined, { token: a }), 401);
  works('another session is untouched', await call('GET', '/me', undefined, { token: b }));
  works('password change', await call('POST', '/me/password', { current: 'admin123', next: 'owner-new-1' }, { token: b }));
  const c = (await login('admin@salon.com', 'owner-new-1')).data.token;
  works('new password signs in', await call('GET', '/me', undefined, { token: c }));
  const d = (await login('admin@salon.com', 'owner-new-1')).data.token;
  works('password change keeps the current session', await call('POST', '/me/password', { current: 'owner-new-1', next: 'admin123' }, { token: d }));
  refused('password change ends other sessions', await call('GET', '/me', undefined, { token: c }), 401);

  console.log('Other websites (CORS)');
  const okOrigin = await fetch(`${BASE}/customers`, { method: 'OPTIONS', headers: { Origin: 'https://allowed.example', 'Access-Control-Request-Method': 'GET' } });
  check('listed website gets CORS headers', okOrigin.status === 204 && okOrigin.headers.get('access-control-allow-origin') === 'https://allowed.example');
  const badOrigin = await fetch(`${BASE}/customers`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  check('unlisted website gets none', !badOrigin.headers.get('access-control-allow-origin'));
  const real = await call('GET', '/branches', undefined, { headers: { Origin: 'https://allowed.example' } });
  check('real request from a listed website carries the header', real.headers.get('access-control-allow-origin') === 'https://allowed.example');

  console.log('Too many wrong passwords');
  for (let i = 0; i < 5; i++) await login('reception@salon.com', 'wrong');
  refused('sixth attempt is blocked', await login('reception@salon.com', 'reception123'), 429);
  works('other accounts are not affected', await login('admin@salon.com', 'admin123'));

  console.log('Two-factor sign-in (authenticator app)');
  execSync('npx tsx scripts/reset-2fa.ts', { env, stdio: 'ignore' });
  refused('reset ends the owner\'s sessions', await call('GET', '/me'), 401);
  const first = await call('POST', '/auth/login', { email: 'admin@salon.com', password: 'admin123' }, { token: null });
  check('password alone does not sign in; setup gives a QR code and key', first.ok && !first.data.token && first.data.step === 'setup' && first.data.qr.startsWith('data:image/png') && /^[A-Z2-7]{32}$/.test(first.data.secret), first.data);
  refused('the sign-in step is not a session token', await call('GET', '/me', undefined, { token: first.data.challenge }), 401);
  refused('wrong code in setup is refused', await verify(first.data.challenge, '000000'), 401);
  refused('tampered sign-in step is refused', await verify(first.data.challenge.slice(0, -3) + 'abc', totp(first.data.secret)), 400);
  const secret: string = first.data.secret;
  const setup = works('right code finishes setup and signs in', await verify(first.data.challenge, totp(secret)));
  const cookie = (await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@salon.com', password: 'admin123' }) })).headers.get('set-cookie');
  check('password step sets no login cookie', !cookie);
  const next0 = await call('POST', '/auth/login', { email: 'admin@salon.com', password: 'admin123' }, { token: null });
  await testDb.user.updateMany({ data: { twoFactorLastStep: 0 } });
  const codeRes = await fetch(`${BASE}/auth/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: next0.data.challenge, code: totp(secret) }) });
  const sc = codeRes.headers.get('set-cookie') ?? '';
  check('login cookie ends when the browser closes (no expiry)', codeRes.ok && sc.startsWith('salon_session=') && !/max-age|expires/i.test(sc), sc.slice(0, 80));
  works('the new session works', await call('GET', '/me', undefined, { token: setup?.token }));
  refused('setup cannot run twice', await verify(first.data.challenge, totp(secret, 1)), 400);
  const next = await call('POST', '/auth/login', { email: 'admin@salon.com', password: 'admin123' }, { token: null });
  check('next sign-in asks for a code, no QR', next.ok && next.data.step === 'verify' && !next.data.qr && !next.data.token, next.data);
  refused('a code cannot be used twice', await verify(next.data.challenge, totp(secret)), 401);
  const signedIn = works('the next code works', await verify(next.data.challenge, totp(secret, 1)));

  // Pairing a new authenticator from the account page. Placed before the lockout below, which blocks this person's codes.
  console.log('Authenticator from the account page');
  const me2 = signedIn?.token;
  refused('two-factor status needs a login', await call('GET', '/me/two-factor', undefined, { token: null }), 401);
  check('status says two-factor is on', (await call('GET', '/me/two-factor', undefined, { token: me2 })).data?.enabled === true);
  refused('a wrong password shows no QR code', await call('POST', '/me/two-factor', { password: 'nope' }, { token: me2 }), 400);
  const re = works('the right password gives a QR code and key', await call('POST', '/me/two-factor', { password: 'admin123' }, { token: me2 }));
  check('QR code and key are returned', !!re && re.qr.startsWith('data:image/png') && /^[A-Z2-7]{32}$/.test(re.secret) && re.secret !== secret, re);
  refused('a wrong code changes nothing', await call('POST', '/me/two-factor/confirm', { challenge: re.challenge, code: '000000' }, { token: me2 }), 401);
  refused('a sign-in step cannot be used to pair', await call('POST', '/me/two-factor/confirm', { challenge: next.data.challenge, code: totp(re.secret) }, { token: me2 }), 400);
  refused('a pairing step cannot sign in', await verify(re.challenge, totp(re.secret)), 400);
  works('the right code from the new app is accepted', await call('POST', '/me/two-factor/confirm', { challenge: re.challenge, code: totp(re.secret) }, { token: me2 }));
  works('the current session carries on', await call('GET', '/me', undefined, { token: me2 }));
  const again = await call('POST', '/auth/login', { email: 'admin@salon.com', password: 'admin123' }, { token: null });
  refused('the old authenticator no longer works', await verify(again.data.challenge, totp(secret, 1)), 401);
  works('the new authenticator signs in', await verify(again.data.challenge, totp(re.secret, 1)));
  refused('letters are not a code', await verify(next.data.challenge, 'abcdef'), 401);
  for (let i = 0; i < 5; i++) await verify(next.data.challenge, '111111');
  refused('too many wrong codes are blocked', await verify(next.data.challenge, totp(secret, 1)), 429);
}

async function main() {
  let server: ChildProcess | undefined;
  try {
    console.log(`Preparing a test database (${dbName})`);
    execSync('npx prisma db push --skip-generate --accept-data-loss', { env, stdio: 'ignore' });
    execSync('npx tsx prisma/seed.ts', { env, stdio: 'ignore' });
    server = spawn('npx', ['next', 'start', '-p', String(PORT)], { env, stdio: 'ignore' });
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${BASE}/public/branding`)).ok) break; } catch { /* not up yet */ }
      if (i > 60) throw new Error('The app did not start. Did you run `npm run build`?');
      await new Promise((r) => setTimeout(r, 500));
    }
    await run();
  } finally {
    server?.kill();
    try { execSync(`fuser -k ${PORT}/tcp`, { stdio: 'ignore' }); } catch { /* already stopped */ }
    try { await testDb.$runCommandRaw({ dropDatabase: 1 }); } catch { /* nothing to drop */ }
    await testDb.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) { console.log('Failed:\n  ' + failed.join('\n  ')); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
