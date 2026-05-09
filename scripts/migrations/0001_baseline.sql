-- Baseline migration — kept intentionally empty.
-- Schema bootstrap is owned by server/db/schema-pg.js and schema-sqlite.js,
-- which initDatabase() runs on every boot. This file exists so the runner
-- has a known starting point; new changes go in 0002_*.sql, 0003_*.sql, etc.

CREATE TABLE IF NOT EXISTS _migration_baseline (
    id INTEGER PRIMARY KEY,
    note TEXT
);
