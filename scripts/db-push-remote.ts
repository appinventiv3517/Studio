// Creates the tables on the libSQL database (Railway). `prisma db push` cannot talk to it, so this builds the
// SQL from prisma/schema.prisma and runs it. Safe to repeat: tables that exist are left alone.
// Usage: LIBSQL_URL=... LIBSQL_AUTH_TOKEN=... npm run db:push-remote
import { execSync } from 'child_process';
import { createClient } from '@libsql/client';

const url = process.env.LIBSQL_URL;
if (!url) throw new Error('Set LIBSQL_URL (and LIBSQL_AUTH_TOKEN) first.');
const sql = execSync('npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script', { encoding: 'utf8', maxBuffer: 20_000_000 });
const statements = sql
  .replace(/^--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ').replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS '));

const client = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN || undefined });
client.batch(statements.map((sql) => ({ sql, args: [] })), 'write').then(
  () => { console.log(`Database ready (${statements.length} statements).`); client.close(); },
  (e) => { console.error(e); process.exit(1); },
);
