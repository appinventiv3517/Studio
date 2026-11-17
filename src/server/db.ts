import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';

const g = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Where the data lives. Locally and in the desktop app it is the SQLite file in DATABASE_URL.
 * When LIBSQL_URL is set (the live deployment), it is a libSQL server (SQLite over HTTP) instead:
 * LIBSQL_URL is its address and LIBSQL_AUTH_TOKEN the key to it. See deploy/README.md.
 */
function connect() {
  const url = process.env.LIBSQL_URL;
  if (!url) return new PrismaClient();
  return new PrismaClient({ adapter: new PrismaLibSQL(createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN || undefined })) });
}

export const db = g.prisma ?? connect();
if (process.env.NODE_ENV !== 'production') g.prisma = db;
