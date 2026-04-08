# Casino Project Rules

## CRITICAL: Revenue Protection Rules

These rules exist because they have been violated repeatedly, causing direct revenue loss.

### 1. ALL free bonuses MUST use `bonus_balance` with wagering requirements

**NEVER** credit free bonus money to `balance` (withdrawable). Always use:
```sql
UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?
```

Wagering multipliers:
- Standard bonuses: 15x
- Loss compensation (cashback, insurance, streak saver): 10x
- Battle pass: 20x
- Deposit match / retention: 30x
- First deposit: 45x

### 2. Streak saver in spin.routes.js MUST use bonus_balance

The streak saver (~line 847-856) gives free credits after 10 consecutive losses. This has been reverted to `balance` **4 times** by other sessions. It MUST remain:
```javascript
await db.run('UPDATE users SET bonus_balance = COALESCE(bonus_balance, 0) + ?, wagering_requirement = COALESCE(wagering_requirement, 0) + ? WHERE id = ?', [streakBonus, streakBonus * 10, userId]);
```
**NOT** `UPDATE users SET balance = balance + ?`. Free credits to `balance` = instant withdrawable cash = revenue leak.

### 3. Retention bonus in withdrawal-enhance.routes.js MUST use bonus_balance

The accept-offer endpoint must credit `bonus_balance`, not `balance`.

### 4. Balance operations MUST be atomic

Use `balance = balance + ?` or `balance = balance - ? WHERE balance >= ?`, **never** `balance = ?` (read-then-set race condition).

### 5. Wagering requirements MUST accumulate

Use `wagering_requirement = COALESCE(wagering_requirement, 0) + ?`, **never** `wagering_requirement = ?` (overwrites existing requirements).

### 6. All bonus claim routes MUST use `bonusGuard` middleware

Every POST route that credits bonus_balance needs:
```javascript
const { bonusGuard } = require('../middleware/bonus-guard');
router.post('/claim', authenticate, bonusGuard, async (req, res) => { ... });
```
This enforces self-exclusion checks and daily bonus caps.

### 7. No Math.random() on server side

Use `crypto.randomBytes()` for all server-side randomness. `Math.random()` is predictable in Node.js.

## Workflow
- Commit directly to `master` (no feature branches)
- Run `npm run qa:regression` before every commit
- Push to `origin/master` after every commit
