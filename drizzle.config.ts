// BEACON — Drizzle config (E0·T-017; ADR-013). Postgres; schema authored in src/adapters/persistence.
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/adapters/persistence/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://beacon:beacon@localhost:5432/beacon',
  },
});
