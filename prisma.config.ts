import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: './prisma/schema.prisma',
  migrate: {
    async adapter() {
      const { PrismaPg } = await import('@prisma/adapter-pg');
      const { default: pg } = await import('pg');
      const connStr = process.env.ZEUS_DATABASE_URL ?? process.env.DATABASE_URL;
      const pool = new pg.Pool({ connectionString: connStr });
      return new PrismaPg(pool);
    },
  },
});
