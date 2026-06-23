#!/usr/bin/env node
'use strict';

/**
 * INSERT completeness + creator-drift analyzer (sibling to check-schema-dml-consistency.js).
 *
 * Two more runtime-SQL-failure classes in the same family as the column-drift bug:
 *
 *  A. NOT-NULL omission — a static `INSERT INTO t (cols…) VALUES …` that omits a column
 *     declared NOT NULL without a DEFAULT (and not an auto PK) throws
 *     `NOT NULL constraint failed: t.col` (sqlite) / `null value in column "col" violates
 *     not-null constraint` (pg) at runtime. Real incidents fixed in c0334617:
 *     deposits.payment_type (bundle.service) and transactions.balance_before/after
 *     (referralbonus) — both omitted required columns.
 *
 *  B. Creator drift — a table CREATEd in ≥2 places (schema files + route/service bootstraps)
 *     with DIFFERENT column sets. CREATE TABLE IF NOT EXISTS makes whoever runs first win,
 *     so if the first creator lacks a column the code uses, it breaks. Real incidents:
 *     audit_log (63631c92) and rg_admin_audit (c0334617).
 *
 * Static + conservative: skips dynamic column lists, INSERT…SELECT, and DEFAULT VALUES.
 * Findings are candidates — verify each (a NOT NULL col may be backfilled by a trigger,
 * an upsert path, or supplied positionally). Exit 1 if any finding.
 *
 * Usage:  node scripts/check-insert-completeness.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const SCHEMA_PG = path.join(SERVER, 'db', 'schema-pg.js');
const SCHEMA_SQLITE = path.join(SERVER, 'db', 'schema-sqlite.js');

const CONSTRAINT_KW = new Set(['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'KEY', 'INDEX']);

function walkJs(dir, out) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === '.git') continue;
            walkJs(full, out);
        } else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
    }
    return out;
}
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
function lineAt(t, i) { let n = 1; for (let k = 0; k < i && k < t.length; k++) if (t[k] === '\n') n++; return n; }

function splitTopLevel(s) {
    const parts = []; let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === '(') { depth++; cur += ch; }
        else if (ch === ')') { depth--; cur += ch; }
        else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
        else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

// Parse a CREATE TABLE body into [{name, required}] — required = NOT NULL, no DEFAULT,
// not an auto-increment / serial primary key.
function parseColumns(body) {
    const cols = [];
    for (const frag of splitTopLevel(body)) {
        const t = frag.trim();
        if (!t) continue;
        const m = t.match(/^["`\[]?([A-Za-z_]\w*)/);
        if (!m) continue;
        const name = m[1];
        if (CONSTRAINT_KW.has(name.toUpperCase())) continue;
        const rest = t.slice(m[0].length);
        const isAutoPk = /\bPRIMARY\s+KEY\b/i.test(rest) && (/\bSERIAL\b|\bAUTOINCREMENT\b/i.test(t) || /\bINTEGER\s+PRIMARY\s+KEY\b/i.test(t));
        const notNull = /\bNOT\s+NULL\b/i.test(rest);
        const hasDefault = /\bDEFAULT\b/i.test(rest);
        const required = notNull && !hasDefault && !isAutoPk;
        cols.push({ name: name.toLowerCase(), required });
    }
    return cols;
}

// Find every CREATE TABLE IF NOT EXISTS <t> ( … ) with BALANCED parens; concat-clean.
function extractCreateTables(text) {
    const out = [];
    const re = /CREATE TABLE IF NOT EXISTS\s+["`]?([A-Za-z_]\w*)["`]?\s*\(/gi;
    let m;
    while ((m = re.exec(text))) {
        const open = re.lastIndex - 1;
        let depth = 0, end = -1;
        for (let i = open; i < text.length; i++) {
            const ch = text[i];
            if (ch === '(') depth++;
            else if (ch === ')') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) {
            const body = text.slice(open + 1, end).replace(/['"`]\s*\+\s*['"`]/g, ' ');
            out.push({ table: m[1].toLowerCase(), body });
        }
    }
    return out;
}

// ── Required-column sets from the two schema files ──────────────────────────
function requiredFromSchema(file) {
    const mod = require(file);
    const reqd = {}; // table -> Set(required col)
    const all = {};  // table -> Set(all cols)
    for (const ddl of mod.TABLES || []) {
        const mt = ddl.match(/CREATE TABLE IF NOT EXISTS\s+["`]?([A-Za-z_]\w*)/i);
        if (!mt) continue;
        const t = mt[1].toLowerCase();
        const open = ddl.indexOf('('), close = ddl.lastIndexOf(')');
        if (open < 0 || close < 0) continue;
        reqd[t] = reqd[t] || new Set();
        all[t] = all[t] || new Set();
        for (const c of parseColumns(ddl.slice(open + 1, close))) {
            all[t].add(c.name);
            if (c.required) reqd[t].add(c.name);
        }
    }
    return { reqd, all };
}

const pg = requiredFromSchema(SCHEMA_PG);
const sqlite = requiredFromSchema(SCHEMA_SQLITE);

// Columns added later by migration arrays / route ALTERs are nullable (ADD COLUMN can't be
// NOT NULL-without-default on a populated table), so they are never "required" — only the
// original CREATE TABLE columns can be. Migration cols just need to be in `all` for context.
function migCols(file) {
    const mod = require(file);
    const map = { USER_MIGRATIONS: 'users', USER_STATUS_MIGRATIONS: 'users', WITHDRAWAL_MIGRATIONS: 'withdrawals', SPIN_MIGRATIONS: 'spins', TRANSACTION_MIGRATIONS: 'transactions', AUDIT_LOG_MIGRATIONS: 'audit_log' };
    const out = {};
    for (const [exp, t] of Object.entries(map)) {
        if (!Array.isArray(mod[exp])) continue;
        out[t] = out[t] || new Set();
        for (const p of mod[exp]) out[t].add((Array.isArray(p) ? p[0] : p).toLowerCase());
    }
    return out;
}
const pgMig = migCols(SCHEMA_PG), sqliteMig = migCols(SCHEMA_SQLITE);

// ── Collect all creators per table (for creator-drift) ──────────────────────
const allJs = walkJs(SERVER, []);
const SCHEMA_FILES = new Set([SCHEMA_PG, SCHEMA_SQLITE, path.join(SERVER, 'db', 'query-adapter.js')]);
const creators = {}; // table -> [{file, cols:Set}]
for (const file of allJs) {
    if (SCHEMA_FILES.has(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const ct of extractCreateTables(text)) {
        const cols = new Set(parseColumns(ct.body).map(c => c.name));
        (creators[ct.table] = creators[ct.table] || []).push({ file: rel(file), cols });
    }
}
// add schema-file creators (union CREATE-TABLE columns with the table's *_MIGRATIONS columns,
// since e.g. schema-pg.js declares users minimally + adds the rest via USER_MIGRATIONS — those
// columns DO exist on the backend, so they must not count as drift).
function withMig(all, mig) {
    const out = {};
    for (const [t, set] of Object.entries(all)) {
        const merged = new Set(set);
        if (mig[t]) for (const c of mig[t]) merged.add(c);
        out[t] = merged;
    }
    return out;
}
for (const [t, set] of Object.entries(withMig(pg.all, pgMig))) (creators[t] = creators[t] || []).push({ file: 'server/db/schema-pg.js', cols: set });
for (const [t, set] of Object.entries(withMig(sqlite.all, sqliteMig))) (creators[t] = creators[t] || []).push({ file: 'server/db/schema-sqlite.js', cols: set });

// ── Scan INSERTs for omitted required columns ───────────────────────────────
const nullFindings = [];
const insertedCols = {}; // table -> Set(columns ever named in an INSERT) — actionable-drift filter
const DYNAMIC = /[`$]|'\s*\+|\+\s*'/;
for (const file of allJs) {
    if (SCHEMA_FILES.has(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // INSERT INTO <t> ( cols ) … (capture through to VALUES/SELECT/ON to detect form)
    const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`]?([A-Za-z_]\w*)["`]?\s*\(([\s\S]*?)\)\s*([\s\S]{0,12})/gi;
    let m;
    while ((m = re.exec(text))) {
        const table = m[1].toLowerCase();
        const colsRaw = m[2];
        const after = m[3] || '';
        if (DYNAMIC.test(colsRaw)) continue;                 // dynamic col list
        if (/SELECT/i.test(after)) continue;                 // INSERT … SELECT (cols from query)
        const list = splitTopLevel(colsRaw).map(s => s.trim().replace(/["`]/g, ''));
        if (!list.every(x => /^[A-Za-z_]\w*$/.test(x))) continue;
        const provided = new Set(list.map(c => c.toLowerCase()));
        insertedCols[table] = insertedCols[table] || new Set();
        for (const c of provided) insertedCols[table].add(c);
        // required = union of required-in-pg and required-in-sqlite for this table
        const req = new Set([...(pg.reqd[table] || []), ...(sqlite.reqd[table] || [])]);
        // a column "provided" via a route bootstrap default still must be in VALUES if NOT NULL
        // without default; we only trust schema-file CREATE for requiredness (high signal).
        const missing = [...req].filter(c => !provided.has(c));
        for (const c of missing) {
            nullFindings.push({ file: rel(file), line: lineAt(text, m.index), table, col: c });
        }
    }
}

// ── Creator drift ───────────────────────────────────────────────────────────
const driftFindings = [];
for (const [table, list] of Object.entries(creators)) {
    if (list.length < 2) continue;
    // union and per-creator diffs
    const union = new Set();
    for (const c of list) for (const col of c.cols) union.add(col);
    // a creator "drifts" if it is missing a column another creator declares — but only
    // ACTIONABLE drift matters: a missing column that some INSERT actually names (so if the
    // missing-column creator wins, that INSERT throws). Columns no INSERT references (e.g.
    // audit_log.ip, which the helper folds into details JSON) are benign and not reported.
    const inserted = insertedCols[table] || new Set();
    const diffs = [];
    for (const c of list) {
        const missing = [...union].filter(col => !c.cols.has(col) && inserted.has(col));
        if (missing.length) diffs.push({ file: c.file, missing });
    }
    // only report when creators genuinely disagree on an INSERT-referenced column
    if (diffs.length) {
        driftFindings.push({ table, creators: list.map(c => c.file), diffs });
    }
}

// ── Report ──────────────────────────────────────────────────────────────────
let bad = false;
if (nullFindings.length) {
    bad = true;
    // de-dupe
    const seen = new Set();
    const uniq = nullFindings.filter(f => { const k = `${f.file}:${f.line}:${f.table}.${f.col}`; if (seen.has(k)) return false; seen.add(k); return true; });
    console.error(`✗ INSERT omits NOT-NULL (no-default) column — ${uniq.length} site(s):\n`);
    for (const f of uniq.sort((a, b) => (a.table + a.col).localeCompare(b.table + b.col))) {
        console.error(`    ${f.table}.${f.col}  ←  ${f.file}:${f.line}`);
    }
    console.error('');
}
// Creator drift is advisory (many are intentional supersets) — print but do not fail on its own.
if (driftFindings.length) {
    console.error(`⚠ creator-drift candidates (same table, differing CREATE column sets) — ${driftFindings.length} table(s):\n`);
    for (const d of driftFindings.sort((a, b) => a.table.localeCompare(b.table))) {
        console.error(`    ${d.table}: creators ${d.creators.join(', ')}`);
        for (const df of d.diffs) console.error(`        ${df.file} MISSING: ${df.missing.join(', ')}`);
    }
    console.error('');
}
if (!nullFindings.length && !driftFindings.length) {
    console.log('✓ INSERT completeness + creator-drift: no candidates found.');
    process.exit(0);
}
process.exit(bad ? 1 : 0);
