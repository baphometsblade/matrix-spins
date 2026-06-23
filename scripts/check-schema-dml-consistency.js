#!/usr/bin/env node
'use strict';

/**
 * Schema ⇄ DML consistency checker (the "audit_log / daily_wager_limit" bug class).
 *
 * Background: the backend runs PostgreSQL in production (server/db/schema-pg.js) and
 * SQLite in dev/test (server/db/schema-sqlite.js). A column referenced by INSERT/UPDATE
 * must be declared for BOTH backends — either in that backend's CREATE TABLE / *_MIGRATIONS,
 * or by a route/service bootstrap (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN,
 * which run via the db facade on both backends). When a column is declared on one backend
 * only, code passes on SQLite (dev/test) but throws `column "X" does not exist` on the
 * PostgreSQL production backend. Two real incidents:
 *   - audit_log.amount / .reference   (fixed, commit 63631c92)
 *   - user_limits.daily_wager_limit   (declared in sqlite schema, absent from pg schema)
 *
 * This static analyzer parses every declared column (both schema files + their migration
 * arrays + every route/service CREATE TABLE & ALTER ADD COLUMN) and every column referenced
 * by a STATIC INSERT/UPDATE in server/, then reports any reference that is undeclared on a
 * backend. Function/param differences (datetime('now'), ?, strftime, …) are handled by
 * server/db/query-adapter.js and are NOT column issues, so they are ignored here.
 *
 * Conservative by design: dynamically-built column lists (template literals / string
 * concatenation / `setIf('col', …)` builders) are SKIPPED, not guessed — so a clean run
 * means "no statically-provable drift", and findings are high-confidence.
 *
 * Usage:  node scripts/check-schema-dml-consistency.js
 * Exit:   0 = no drift, 1 = drift/undeclared columns found.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');

// Which exported *_MIGRATIONS array targets which table, per schema module.
const MIG_TABLE = {
    USER_MIGRATIONS: 'users',
    USER_STATUS_MIGRATIONS: 'users',
    WITHDRAWAL_MIGRATIONS: 'withdrawals',
    SPIN_MIGRATIONS: 'spins',
    TRANSACTION_MIGRATIONS: 'transactions',
    AUDIT_LOG_MIGRATIONS: 'audit_log',
};

const COL_CONSTRAINT_KW = new Set([
    'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'KEY', 'INDEX',
]);

// ── helpers ─────────────────────────────────────────────────────────────────

function walkJs(dir, out) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === '.git') continue;
            walkJs(full, out);
        } else if (ent.isFile() && ent.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }

function lineAt(text, index) {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
    return line;
}

// Parse the SET clause of an UPDATE starting just after "SET ", returning the assigned
// column names. Quote/paren-aware so SQL string literals (datetime('now','+24 hours')),
// function calls, and subqueries don't confuse it. Returns null if the SET clause is built
// with a JS template/`${…}` interpolation (dynamic — cannot adjudicate statically).
function parseUpdateSetColumns(text, fromIdx) {
    const cols = [];
    let i = fromIdx, depth = 0, expectCol = true;
    const N = text.length;
    while (i < N) {
        const ch = text[i];
        if (ch === "'") { // SQL single-quoted string literal — skip it
            i++;
            while (i < N) { if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue; } break; } i++; }
            i++; expectCol = false; continue;
        }
        if (ch === '$' && text[i + 1] === '{') return null; // dynamic SET — bail
        if (ch === '(') { depth++; i++; continue; }
        if (ch === ')') { depth--; i++; continue; }
        if (depth === 0) {
            if (ch === ',') { expectCol = true; i++; continue; }
            if (/[A-Za-z_]/.test(ch)) {
                let j = i; while (j < N && /\w/.test(text[j])) j++;
                const word = text.slice(i, j), upper = word.toUpperCase();
                if (upper === 'WHERE' || upper === 'RETURNING' || upper === 'FROM') break;
                if (expectCol) { cols.push(word.toLowerCase()); expectCol = false; }
                i = j; continue;
            }
            if (ch === '`' || ch === '"' || ch === ';') break; // end of the JS SQL string literal
        }
        i++;
    }
    return cols;
}

// Split `a, b(x,y), c` on top-level commas only (respects parens).
function splitTopLevel(s) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === '(') { depth++; cur += ch; }
        else if (ch === ')') { depth--; cur += ch; }
        else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
        else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

// Extract column names from a CREATE TABLE (...) DDL body.
function columnsFromCreateTable(ddl) {
    const open = ddl.indexOf('(');
    const close = ddl.lastIndexOf(')');
    if (open === -1 || close === -1 || close < open) return [];
    const body = ddl.slice(open + 1, close);
    const cols = [];
    for (const frag of splitTopLevel(body)) {
        const t = frag.trim();
        if (!t) continue;
        const first = t.match(/^["`\[]?([A-Za-z_]\w*)/);
        if (!first) continue;
        const name = first[1];
        if (COL_CONSTRAINT_KW.has(name.toUpperCase())) continue;
        cols.push(name.toLowerCase());
    }
    return cols;
}

function tableNameOfCreate(ddl) {
    const m = ddl.match(/CREATE TABLE IF NOT EXISTS\s+["`]?([A-Za-z_]\w*)/i);
    return m ? m[1].toLowerCase() : null;
}

// Find every `CREATE TABLE IF NOT EXISTS <t> ( … )` in arbitrary source text, returning
// {table, body} with the column body delimited by BALANCED parens (so nested parens like
// REFERENCES users(id) / NUMERIC(15,2) / DEFAULT (datetime('now')) don't truncate it).
function extractCreateTables(text) {
    const out = [];
    const re = /CREATE TABLE IF NOT EXISTS\s+["`]?([A-Za-z_]\w*)["`]?\s*\(/gi;
    let m;
    while ((m = re.exec(text))) {
        const open = re.lastIndex - 1; // index of '('
        let depth = 0, end = -1;
        for (let i = open; i < text.length; i++) {
            const ch = text[i];
            if (ch === '(') depth++;
            else if (ch === ')') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) out.push({ table: m[1], body: text.slice(open + 1, end) });
    }
    return out;
}

// ── 1. Declared columns from the two schema modules ─────────────────────────

function loadSchemaModule(file) {
    const mod = require(file);
    const create = {};   // table -> Set(cols)
    for (const ddl of mod.TABLES || []) {
        const t = tableNameOfCreate(ddl);
        if (!t) continue;
        create[t] = create[t] || new Set();
        for (const c of columnsFromCreateTable(ddl)) create[t].add(c);
    }
    // Migration arrays ([colName, def] pairs) keyed to their target table.
    for (const [exp, table] of Object.entries(MIG_TABLE)) {
        const arr = mod[exp];
        if (!Array.isArray(arr)) continue;
        create[table] = create[table] || new Set();
        for (const pair of arr) {
            const name = Array.isArray(pair) ? pair[0] : pair;
            if (typeof name === 'string') create[table].add(name.toLowerCase());
        }
    }
    return create;
}

const pgCols = loadSchemaModule(path.join(SERVER, 'db', 'schema-pg.js'));
const sqliteCols = loadSchemaModule(path.join(SERVER, 'db', 'schema-sqlite.js'));

// ── 2. Bootstrap columns from route/service/index CREATE TABLE & ALTER ──────
//      These run through the db facade → apply to BOTH backends.

const bootstrap = {}; // table -> Set(cols)
function addBoot(table, col) {
    const t = table.toLowerCase();
    bootstrap[t] = bootstrap[t] || new Set();
    bootstrap[t].add(col.toLowerCase());
}

const allJs = walkJs(SERVER, []);
const SCHEMA_FILES = new Set([
    path.join(SERVER, 'db', 'schema-pg.js'),
    path.join(SERVER, 'db', 'schema-sqlite.js'),
    path.join(SERVER, 'db', 'query-adapter.js'),
]);

// SQL column types used to recognise a "<name> <TYPE> …" column-def string literal
// inside a dynamic ALTER loop (e.g. ['totp_secret TEXT', …].forEach(c =>
// db.run('ALTER TABLE users ADD COLUMN ' + c))). The literal ALTER regex cannot see
// the column name in that pattern, so we harvest it from the def strings instead.
const COL_TYPE = '(?:TEXT|INTEGER|REAL|NUMERIC|BOOLEAN|BOOL|TIMESTAMPTZ|TIMESTAMP|BIGINT|SMALLINT|DATE|DATETIME|JSONB|JSON|VARCHAR|SERIAL|DECIMAL|DOUBLE|FLOAT|BLOB|UUID)';

for (const file of allJs) {
    if (SCHEMA_FILES.has(file)) continue; // backend-specific schemas are handled per-backend, NOT as shared bootstrap
    const text = fs.readFileSync(file, 'utf8');
    // CREATE TABLE IF NOT EXISTS <t> ( ... )  — balanced-paren body.
    let m;
    for (const ct of extractCreateTables(text)) {
        // Collapse JS string-concatenation joints (`' + '`, `" + "`) and template-literal
        // boundaries so a DDL assembled from concatenated string fragments parses as one
        // continuous column list (e.g. tournament.service.js builds CREATE TABLE that way).
        const cleaned = ct.body.replace(/['"`]\s*\+\s*['"`]/g, ' ');
        for (const c of columnsFromCreateTable('(' + cleaned + ')')) addBoot(ct.table, c);
    }
    // ALTER TABLE <t> ADD COLUMN <c>  (literal column name)
    const alterRe = /ALTER TABLE\s+["`]?([A-Za-z_]\w*)["`]?\s+ADD COLUMN\s+["`]?([A-Za-z_]\w*)/gi;
    while ((m = alterRe.exec(text))) addBoot(m[1], m[2]);
    // Dynamic ALTER loops: capture the table(s) ALTERed in this file, then harvest every
    // '<name> <TYPE> …' column-def string literal and attribute it to those table(s).
    const altTables = new Set();
    const altTblRe = /ALTER TABLE\s+["`]?([A-Za-z_]\w*)["`]?\s+ADD COLUMN\b/gi;
    while ((m = altTblRe.exec(text))) altTables.add(m[1].toLowerCase());
    if (altTables.size) {
        const defRe = new RegExp("['\"]([a-z_]\\w*)\\s+" + COL_TYPE + "\\b", 'gi');
        while ((m = defRe.exec(text))) for (const t of altTables) addBoot(t, m[1]);
    }
}

// ── 3. DML column references (static only) ──────────────────────────────────

const findings = [];   // {file, line, table, col, kind}
const DYNAMIC = /[`$]|'\s*\+|\+\s*'/;   // template/concat markers → skip

function declaredTables() {
    const s = new Set([
        ...Object.keys(pgCols), ...Object.keys(sqliteCols), ...Object.keys(bootstrap),
    ]);
    return s;
}
const KNOWN = declaredTables();

function checkRef(file, text, idx, table, col) {
    const t = table.toLowerCase();
    const c = col.toLowerCase();
    if (!KNOWN.has(t)) return; // table created dynamically/elsewhere — can't adjudicate
    const inPg = (pgCols[t] && pgCols[t].has(c)) || (bootstrap[t] && bootstrap[t].has(c));
    const inSqlite = (sqliteCols[t] && sqliteCols[t].has(c)) || (bootstrap[t] && bootstrap[t].has(c));
    // Only adjudicate backends where the TABLE itself is declared in that schema file
    // (a table may live only in one schema file + bootstrap; that's fine).
    const tableInPg = pgCols[t] || bootstrap[t];
    const tableInSqlite = sqliteCols[t] || bootstrap[t];
    const missPg = tableInPg && !inPg;
    const missSqlite = tableInSqlite && !inSqlite;
    if (!missPg && !missSqlite) return;
    let kind;
    if (missPg && missSqlite) kind = 'UNDECLARED (both backends)';
    else if (missPg) kind = 'DRIFT → missing on PostgreSQL (PROD)';
    else kind = 'DRIFT → missing on SQLite (dev/test)';
    findings.push({ file: rel(file), line: lineAt(text, idx), table: t, col: c, kind });
}

for (const file of allJs) {
    if (SCHEMA_FILES.has(file)) continue;
    const text = fs.readFileSync(file, 'utf8');

    // INSERT INTO <t> ( col, col, ... )
    const insRe = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`]?([A-Za-z_]\w*)["`]?\s*\(([\s\S]*?)\)/gi;
    let m;
    while ((m = insRe.exec(text))) {
        const cols = m[2];
        if (DYNAMIC.test(cols)) continue;                 // dynamic column list — skip
        const list = splitTopLevel(cols).map(s => s.trim());
        if (!list.every(x => /^["`]?[A-Za-z_]\w*["`]?$/.test(x))) continue; // not a plain id list
        for (const raw of list) {
            const col = raw.replace(/["`]/g, '');
            checkRef(file, text, m.index, m[1], col);
        }
    }

    // UPDATE <t> SET <assignments> …  (quote/paren-aware column extraction)
    const updRe = /UPDATE\s+["`]?([A-Za-z_]\w*)["`]?\s+SET\s+/gi;
    while ((m = updRe.exec(text))) {
        const cols = parseUpdateSetColumns(text, updRe.lastIndex);
        if (!cols) continue;                              // dynamic SET — skip
        for (const col of cols) checkRef(file, text, m.index, m[1], col);
    }
}

// ── 4. Report ───────────────────────────────────────────────────────────────

// De-dupe identical (file,line,table,col).
const seen = new Set();
const unique = findings.filter(f => {
    const k = `${f.file}:${f.line}:${f.table}.${f.col}`;
    if (seen.has(k)) return false; seen.add(k); return true;
});

if (unique.length === 0) {
    console.log('✓ schema⇄DML consistency: no statically-provable column drift found.');
    console.log(`  (checked ${KNOWN.size} tables across ${allJs.length} server files)`);
    process.exit(0);
}

console.error(`✗ schema⇄DML consistency: ${unique.length} undeclared/drifted column reference(s):\n`);
const byKind = {};
for (const f of unique) (byKind[f.kind] = byKind[f.kind] || []).push(f);
for (const kind of Object.keys(byKind).sort()) {
    console.error(`  [${kind}]`);
    for (const f of byKind[kind].sort((a, b) => (a.table + a.col).localeCompare(b.table + b.col))) {
        console.error(`    ${f.table}.${f.col}  ←  ${f.file}:${f.line}`);
    }
    console.error('');
}
console.error('Fix: declare the column on the missing backend (CREATE TABLE + a guarded');
console.error('ALTER TABLE … ADD COLUMN migration), or remove the stray DML reference.');
process.exit(1);
