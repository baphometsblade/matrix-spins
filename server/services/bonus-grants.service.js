'use strict';

/**
 * Bonus-grant tracking. A grant is created whenever a user receives
 * credit that comes with a wagering requirement (today: promo codes
 * with wagering_multiplier > 0; future: cashback, operator gifts).
 *
 *   amount_cents             the amount credited
 *   wagering_required_cents  amount × multiplier — the playthrough
 *   wagered_cents            running total attributed by recordWager()
 *   status                   'active' | 'completed' | 'forfeited'
 *
 * recordWager() is called from the slot engine after a successful
 * spin; it walks the user's active grants in FIFO order and credits
 * the bet against each, spilling to the next once a grant tops out.
 *
 * hasActive() / totalRemaining() are used by the withdrawal route to
 * gate cash-outs while any grant is still in playthrough. forfeit()
 * is the operator surface for clearing a stuck grant — the user can
 * cash out but the bonus amount is debited.
 *
 * The slot-engine spin lock (per-user mutex) means two concurrent
 * spins can never race here, so no transaction is needed around the
 * SELECT-UPDATE pair. Outside that lock, any caller is best-effort
 * and may double-update; the SUM-based totalRemaining is monotonic
 * (wagered only ever increases) so divergence is one-way and
 * self-correcting on the next spin.
 */

const db = require('../database');

async function grant(userId, { source, sourceId, amountCents, multiplier }) {
    const numUser = Number(userId);
    if (!Number.isInteger(numUser) || numUser < 1) {
        const e = new Error('Invalid user id.'); e.status = 400; throw e;
    }
    const amt = Number(amountCents);
    if (!Number.isInteger(amt) || amt < 0) {
        const e = new Error('Invalid amount.'); e.status = 400; throw e;
    }
    const m = Number(multiplier) || 0;
    if (!Number.isInteger(m) || m < 0 || m > 100) {
        const e = new Error('Invalid multiplier.'); e.status = 400; throw e;
    }
    const required = amt * m;
    // multiplier=0 ⇒ no playthrough, mark completed at create-time so
    // the grant exists for audit but doesn't gate withdrawals.
    const status = required > 0 ? 'active' : 'completed';
    const completedAt = required > 0 ? null : new Date().toISOString();
    await db.run(
        `INSERT INTO bonus_grants
             (user_id, source, source_id, amount_cents, wagering_required_cents,
              wagered_cents, status, completed_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [numUser, String(source || 'unknown'), sourceId == null ? null : String(sourceId),
         amt, required, status, completedAt]
    );
    const row = await db.get(
        `SELECT * FROM bonus_grants WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
        [numUser]
    );
    return row;
}

async function recordWager(userId, betCents) {
    const numUser = Number(userId);
    if (!Number.isInteger(numUser) || numUser < 1) return;
    let remaining = Number(betCents);
    if (!Number.isFinite(remaining) || remaining <= 0) return;

    // Walk the user's active grants in FIFO order, top each up, spill
    // to the next. We re-fetch on every iteration so a row that's
    // already been completed by a prior iteration drops out naturally.
    while (remaining > 0) {
        const g = await db.get(
            `SELECT id, wagering_required_cents, wagered_cents
               FROM bonus_grants
              WHERE user_id = ? AND status = 'active'
              ORDER BY id ASC LIMIT 1`,
            [numUser]
        );
        if (!g) break;
        const need = Number(g.wagering_required_cents) - Number(g.wagered_cents);
        if (need <= 0) {
            // Defensive: a previous spin's recordWager raced past
            // completion without flipping status. Flip it now.
            await db.run(
                `UPDATE bonus_grants SET status = 'completed', completed_at = ` + db.sqlNow() +
                `  WHERE id = ? AND status = 'active'`,
                [g.id]
            );
            continue;
        }
        const apply = Math.min(remaining, need);
        const newWagered = Number(g.wagered_cents) + apply;
        if (newWagered >= Number(g.wagering_required_cents)) {
            await db.run(
                `UPDATE bonus_grants
                    SET wagered_cents = ?, status = 'completed',
                        completed_at = ` + db.sqlNow() +
                `  WHERE id = ? AND status = 'active'`,
                [newWagered, g.id]
            );
        } else {
            await db.run(
                `UPDATE bonus_grants SET wagered_cents = ?
                  WHERE id = ? AND status = 'active'`,
                [newWagered, g.id]
            );
        }
        remaining -= apply;
    }
}

async function hasActive(userId) {
    const numUser = Number(userId);
    if (!Number.isInteger(numUser) || numUser < 1) return false;
    const r = await db.get(
        `SELECT COUNT(*) AS n FROM bonus_grants WHERE user_id = ? AND status = 'active'`,
        [numUser]
    );
    return Number(r && r.n) > 0;
}

async function totalRemaining(userId) {
    const numUser = Number(userId);
    if (!Number.isInteger(numUser) || numUser < 1) return 0;
    const r = await db.get(
        `SELECT COALESCE(SUM(wagering_required_cents - wagered_cents), 0) AS remaining
           FROM bonus_grants WHERE user_id = ? AND status = 'active'`,
        [numUser]
    );
    return Math.max(0, Number(r && r.remaining) || 0);
}

async function listForUser(userId) {
    const numUser = Number(userId);
    if (!Number.isInteger(numUser) || numUser < 1) return [];
    const rows = await db.all(
        `SELECT id, source, source_id, amount_cents, wagering_required_cents,
                wagered_cents, status, created_at, completed_at
           FROM bonus_grants
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 100`,
        [numUser]
    );
    return rows.map(r => ({
        id: r.id,
        source: r.source,
        source_id: r.source_id,
        amount_cents: Number(r.amount_cents) || 0,
        wagering_required_cents: Number(r.wagering_required_cents) || 0,
        wagered_cents: Number(r.wagered_cents) || 0,
        remaining_cents: Math.max(0, Number(r.wagering_required_cents) - Number(r.wagered_cents)),
        status: r.status,
        created_at: r.created_at,
        completed_at: r.completed_at,
    }));
}

/**
 * User-initiated forfeit: clear an active grant by debiting the
 * remaining unwagered portion of `amount_cents` from the user's
 * balance, then mark the grant 'forfeited'. Lets the player walk
 * away with their winnings without finishing playthrough at the
 * cost of the unplayed bonus.
 *
 * The unplayed portion is computed as
 *     amount × (1 − wagered / required)
 * — i.e. proportional to how much of the playthrough still remains.
 * A user who has already wagered half the requirement only forfeits
 * half the bonus.
 */
async function forfeit(userId, grantId) {
    const numUser = Number(userId);
    const numId = Number(grantId);
    if (!Number.isInteger(numUser) || numUser < 1
     || !Number.isInteger(numId) || numId < 1) {
        const e = new Error('Invalid grant id.'); e.status = 400; throw e;
    }
    const row = await db.get(
        `SELECT id, amount_cents, wagering_required_cents, wagered_cents, status
           FROM bonus_grants WHERE id = ? AND user_id = ?`,
        [numId, numUser]
    );
    if (!row) {
        const e = new Error('Grant not found.'); e.status = 404; throw e;
    }
    if (row.status !== 'active') {
        const e = new Error('Grant is not active.'); e.status = 409; throw e;
    }
    const required = Number(row.wagering_required_cents);
    const wagered = Math.min(Number(row.wagered_cents), required);
    const amt = Number(row.amount_cents);
    const debit = required > 0
        ? Math.max(0, Math.round(amt * (1 - wagered / required)))
        : 0;
    // Status-guarded UPDATE so two concurrent forfeits can't both
    // succeed (and double-debit). The slot-engine lock doesn't cover
    // this code path.
    const upd = await db.run(
        `UPDATE bonus_grants
            SET status = 'forfeited', completed_at = ` + db.sqlNow() +
        `  WHERE id = ? AND status = 'active'`,
        [row.id]
    );
    if (Number(upd && upd.changes) < 1) {
        const e = new Error('Grant state changed under us.'); e.status = 409; throw e;
    }
    if (debit > 0) {
        // We allow the balance to go negative on forfeit — a user who
        // has already withdrawn most of the bonus can still forfeit;
        // operations can square the books from there. In practice the
        // active-grant gate on withdrawals prevents reaching this state.
        await db.run(
            'UPDATE users SET balance_cents = balance_cents - ? WHERE id = ?',
            [debit, numUser]
        );
    }
    return { ok: true, grant_id: row.id, debited_cents: debit };
}

module.exports = {
    grant,
    recordWager,
    hasActive,
    totalRemaining,
    listForUser,
    forfeit,
};
