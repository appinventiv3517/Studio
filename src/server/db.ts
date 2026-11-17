import { PrismaClient } from '@prisma/client';

// The MongoDB database named in DATABASE_URL (see deploy/README.md). MongoDB must run as a replica set
// (Atlas always does) because bills and stock changes use transactions.
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = db;
