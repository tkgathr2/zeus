import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.ZEUS_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
});
