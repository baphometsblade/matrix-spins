# Migrations

Files in this directory are applied in **filename order** by `npm run migrate`.
Each file's SHA-256 is recorded in `_migrations` so re-runs are no-ops; editing
an already-applied file makes the runner refuse to proceed.

Conventions:

- Filename: `NNNN_short_description.sql` (e.g. `0001_initial.sql`).
- Statements separated by semicolons. Lines beginning with `--` are skipped.
- Both PostgreSQL and SQLite must accept the SQL — prefer the common subset
  (`INTEGER` instead of `SERIAL`, `TEXT` instead of `VARCHAR(n)`).
- Schema bootstrap (the canonical `users`, `transactions`, etc.) is owned by
  `server/db/schema-pg.js` and `server/db/schema-sqlite.js`. Migrations here
  are for incremental, post-bootstrap changes.

Apply: `npm run migrate`
