import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const connectionString = process.env.ZEUS_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[Zeus] Fatal: ZEUS_DATABASE_URL or DATABASE_URL is not set. Exiting.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
