import { config } from 'dotenv';
config({ quiet: true });
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --transpile-only src/prisma/seed.ts',
  },
  datasource: { url: env('DATABASE_URL') },
});
