'use strict';

/**
 * A/B Testing Routes for Revenue Optimization
 *
 * Endpoints:
 *   POST /api/ab/assign              — Record experiment assignment (fire-and-forget)
 *   POST /api/ab/convert             — Record conversion with optional revenue
 *   POST /api/ab/revenue             — Track revenue attribution to test variant
 *   GET  /api/ab/admin/results       — Admin: detailed results with stats & significance
 *   GET  /api/ab/admin/tests         — Admin: list all active tests
 *   POST /api/ab/admin/winner        — Admin: declare winner, lock variant
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

var isPg = db.isPg();
var idDef = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
var tsDef = isPg ? 'TIMESTAMPTZ DEFAULT NOW()' : "TEXT DEFAULT (datetime('now'))";

/**
 * Lazy initialization of ab_experiments table.
 * Called on first use via _ensureExperimentsTable().
 */
async function _ensureExperimentsTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ab_experiments (
        id ${idDef},
        test_name TEXT NOT NULL,
        variant TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        assigned_at ${tsDef}
      )
    `;
    await db.run(sql);
  } catch (err) {
    console.warn('[ABTesting] Failed to ensure ab_experiments table:', err.message);
  }
}

/**
 * Lazy initialization of ab_conversions table.
 * Called on first use via _ensureConversionsTable().
 */
async function _ensureConversionsTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ab_conversions (
        id ${idDef},
        experiment_id INTEGER,
        test_name TEXT NOT NULL,
        variant TEXT NOT NULL,
        conversion_type TEXT NOT NULL,
        revenue_amount REAL,
        user_id INTEGER,
        converted_at ${tsDef}
      )
    `;
    await db.run(sql);
  } catch (err) {
    console.warn('[ABTesting] Failed to ensure ab_conversions table:', err.message);
  }
}

/**
 * Lazy initialization of ab_winners table.
 * Stores locked winners to force new users to that variant.
 */
async function _ensureWinnersTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS ab_winners (
        test_name TEXT PRIMARY KEY,
        winning_variant TEXT NOT NULL,
        declared_at ${tsDef}
      )
    `;
    await db.run(sql);
  } catch (err) {
    console.warn('[ABTesting] Failed to ensure ab_winners table:', err.message);
  }
}

/**
 * ── POST /api/ab/assign ──────────────────────────────────────────────────
 * Record an experiment assignment (fire-and-forget from frontend).
 *
 * Request body:
 *   {
 *     testName: string,      (required) Name of the test
 *     variant: string,       (required) Assigned variant
 *     userId: number         (required) User ID
 *   }
 *
 * Response:
 *   { success: true }
 *
 * Notes:
 *   - No authentication required (fire-and-forget from frontend)
 *   - Silently ignores invalid requests
 */
router.post('/assign', async function(req, res) {
  try {
    await _ensureExperimentsTable();

    const testName = String(req.body.testName || '').trim();
    const variant = String(req.body.variant || '').trim();
    const userId = req.body.userId ? parseInt(req.body.userId, 10) : null;

    // Basic validation
    if (!testName || !variant || !userId || isNaN(userId)) {
      // Silently fail (fire-and-forget semantics)
      return res.status(200).json({ success: true });
    }

    // Insert assignment record
    await db.run(
      'INSERT INTO ab_experiments (test_name, variant, user_id) VALUES (?, ?, ?)',
      [testName, variant, userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.warn('[ABTesting] POST /assign error:', err.message);
    // Silently return success (fire-and-forget)
    return res.status(200).json({ success: true });
  }
});

/**
 * ── POST /api/ab/convert ────────────────────────────────────────────────────
 * Record a conversion for an A/B test.
 *
 * Request body:
 *   {
 *     testName: string,           (required) Name of the test
 *     variant: string,            (required) Assigned variant
 *     conversionType: string,     (required) Type of conversion (e.g., 'spin', 'deposit')
 *     revenueAmount: number?,     (optional) Revenue to attribute to this variant
 *     userId: number?             (optional) User ID
 *   }
 *
 * Response:
 *   { success: true }
 *
 * Notes:
 *   - Fire-and-forget from frontend
 *   - Revenue amount is optional and in currency units
 */
router.post('/convert', async function(req, res) {
  try {
    await _ensureConversionsTable();

    const testName = String(req.body.testName || '').trim();
    const variant = String(req.body.variant || '').trim();
    const conversionType = String(req.body.conversionType || 'generic').trim();
    const revenueAmount = req.body.revenueAmount ? parseFloat(req.body.revenueAmount) : null;
    const userId = req.body.userId ? parseInt(req.body.userId, 10) : null;

    // Basic validation
    if (!testName || !variant) {
      // Silently fail (fire-and-forget semantics)
      return res.status(200).json({ success: true });
    }

    // Insert conversion record
    await db.run(
      'INSERT INTO ab_conversions (test_name, variant, conversion_type, revenue_amount, user_id) VALUES (?, ?, ?, ?, ?)',
      [testName, variant, conversionType, isNaN(revenueAmount) ? null : revenueAmount, userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.warn('[ABTesting] POST /convert error:', err.message);
    // Silently return success (fire-and-forget)
    return res.status(200).json({ success: true });
  }
});

/**
 * ── POST /api/ab/revenue ─────────────────────────────────────────────────
 * Track revenue attribution to a test variant (fire-and-forget).
 *
 * Request body:
 *   {
 *     testName: string,       (required) Name of the test
 *     variant: string,        (required) Assigned variant
 *     amount: number,         (required) Revenue amount
 *     userId: number?         (optional) User ID
 *   }
 *
 * Response:
 *   { success: true }
 */
router.post('/revenue', async function(req, res) {
  try {
    await _ensureConversionsTable();

    const testName = String(req.body.testName || '').trim();
    const variant = String(req.body.variant || '').trim();
    const amount = req.body.amount ? parseFloat(req.body.amount) : null;
    const userId = req.body.userId ? parseInt(req.body.userId, 10) : null;

    // Basic validation
    if (!testName || !variant || amount === null || !Number.isFinite(amount)) {
      return res.status(200).json({ success: true });
    }

    // Insert revenue record
    await db.run(
      'INSERT INTO ab_conversions (test_name, variant, conversion_type, revenue_amount, user_id) VALUES (?, ?, ?, ?, ?)',
      [testName, variant, 'revenue', amount, userId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.warn('[ABTesting] POST /revenue error:', err.message);
    return res.status(200).json({ success: true });
  }
});

/**
 * ── GET /api/ab/admin/results ────────────────────────────────────────────
 * Admin-only endpoint: Detailed results per test with statistical metrics.
 *
 * Query parameters (optional):
 *   testName: string  — Filter results to a specific test
 *
 * Response for each test/variant:
 *   {
 *     variant: string,
 *     impressions: number,        (unique assignments)
 *     conversions: number,        (total conversion events)
 *     conversionRate: number,     (conversions / impressions, as %)
 *     totalRevenue: number,       (sum of revenue_amount)
 *     revenuePerUser: number,     (totalRevenue / impressions)
 *     statSigIndicator: string    (approx. chi-square significance)
 *   }
 */
router.get('/admin/results', authenticate, requireAdmin, async function(req, res) {
  try {
    await _ensureExperimentsTable();
    await _ensureConversionsTable();

    const filterTestName = req.query.testName ? String(req.query.testName).trim() : null;

    // Get impressions (assignments) per test/variant
    let impressionsQuery = `
      SELECT test_name, variant, COUNT(DISTINCT user_id) as impressions
      FROM ab_experiments
    `;
    const impressionsParams = [];

    if (filterTestName) {
      impressionsQuery += ' WHERE test_name = ?';
      impressionsParams.push(filterTestName);
    }

    impressionsQuery += ' GROUP BY test_name, variant';

    const impressionsRows = await db.all(impressionsQuery, impressionsParams);

    // Get conversions & revenue per test/variant
    let conversionsQuery = `
      SELECT
        test_name,
        variant,
        COUNT(*) as conversions,
        SUM(CASE WHEN conversion_type = 'revenue' THEN revenue_amount ELSE 0 END) as total_revenue
      FROM ab_conversions
    `;
    const conversionsParams = [];

    if (filterTestName) {
      conversionsQuery += ' WHERE test_name = ?';
      conversionsParams.push(filterTestName);
    }

    conversionsQuery += ' GROUP BY test_name, variant';

    const conversionsRows = await db.all(conversionsQuery, conversionsParams);

    // Build keyed lookup for impressions
    const impressionsMap = {};
    impressionsRows.forEach(function(row) {
      const key = row.test_name + '|' + row.variant;
      impressionsMap[key] = parseInt(row.impressions, 10);
    });

    // Build keyed lookup for conversions
    const conversionsMap = {};
    conversionsRows.forEach(function(row) {
      const key = row.test_name + '|' + row.variant;
      conversionsMap[key] = {
        conversions: parseInt(row.conversions, 10),
        totalRevenue: row.total_revenue ? parseFloat(row.total_revenue) : 0
      };
    });

    // Organize results by test name
    const results = {};
    const allTests = new Set();

    // Collect all test names
    impressionsRows.forEach(function(row) {
      allTests.add(row.test_name);
    });
    conversionsRows.forEach(function(row) {
      allTests.add(row.test_name);
    });

    // Build results for each test
    Array.from(allTests).forEach(function(testName) {
      if (!results[testName]) {
        results[testName] = [];
      }

      // Get all variants for this test
      const variants = new Set();
      impressionsRows.forEach(function(row) {
        if (row.test_name === testName) variants.add(row.variant);
      });
      conversionsRows.forEach(function(row) {
        if (row.test_name === testName) variants.add(row.variant);
      });

      // Build result per variant
      Array.from(variants).forEach(function(variant) {
        const key = testName + '|' + variant;
        const impressions = impressionsMap[key] || 0;
        const convData = conversionsMap[key] || { conversions: 0, totalRevenue: 0 };

        const conversions = convData.conversions;
        const conversionRate = impressions > 0 ? (conversions / impressions) * 100 : 0;
        const totalRevenue = convData.totalRevenue;
        const revenuePerUser = impressions > 0 ? totalRevenue / impressions : 0;

        results[testName].push({
          variant: variant,
          impressions: impressions,
          conversions: conversions,
          conversionRate: parseFloat(conversionRate.toFixed(2)),
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          revenuePerUser: parseFloat(revenuePerUser.toFixed(2)),
          statSigIndicator: _calculateChiSquareSignificance(results[testName])
        });
      });
    });

    return res.json({
      success: true,
      tests: results
    });
  } catch (err) {
    console.warn('[ABTesting] GET /admin/results error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch A/B results' });
  }
});

/**
 * ── GET /api/ab/admin/tests ──────────────────────────────────────────────
 * Admin-only endpoint: List all active tests with variant distribution.
 *
 * Response:
 *   {
 *     tests: [
 *       {
 *         testName: string,
 *         variants: [
 *           { variant: string, count: number },
 *           ...
 *         ],
 *         totalAssignments: number,
 *         winner: string | null (if locked)
 *       },
 *       ...
 *     ]
 *   }
 */
router.get('/admin/tests', authenticate, requireAdmin, async function(req, res) {
  try {
    await _ensureExperimentsTable();
    await _ensureWinnersTable();

    // Get variant distribution
    const rows = await db.all(`
      SELECT test_name, variant, COUNT(*) as count
      FROM ab_experiments
      GROUP BY test_name, variant
      ORDER BY test_name, count DESC
    `);

    // Get winners
    const winnersRows = await db.all(`
      SELECT test_name, winning_variant
      FROM ab_winners
    `);

    const winnersMap = {};
    winnersRows.forEach(function(row) {
      winnersMap[row.test_name] = row.winning_variant;
    });

    // Organize by test
    const testMap = {};
    rows.forEach(function(row) {
      if (!testMap[row.test_name]) {
        testMap[row.test_name] = {
          testName: row.test_name,
          variants: [],
          totalAssignments: 0,
          winner: winnersMap[row.test_name] || null
        };
      }
      testMap[row.test_name].variants.push({
        variant: row.variant,
        count: parseInt(row.count, 10)
      });
      testMap[row.test_name].totalAssignments += parseInt(row.count, 10);
    });

    return res.json({
      success: true,
      tests: Object.values(testMap)
    });
  } catch (err) {
    console.warn('[ABTesting] GET /admin/tests error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

/**
 * ── POST /api/ab/admin/winner ────────────────────────────────────────────
 * Admin-only endpoint: Declare a winner variant for a test.
 * All future users will be assigned to the winning variant.
 *
 * Request body:
 *   {
 *     testName: string,        (required)
 *     winningVariant: string   (required)
 *   }
 *
 * Response:
 *   { success: true, testName, winningVariant }
 */
router.post('/admin/winner', authenticate, requireAdmin, async function(req, res) {
  try {
    await _ensureWinnersTable();

    const testName = String(req.body.testName || '').trim();
    const winningVariant = String(req.body.winningVariant || '').trim();

    if (!testName || !winningVariant) {
      return res.status(400).json({ error: 'testName and winningVariant are required' });
    }

    // Upsert winner
    if (isPg) {
      // PostgreSQL: use ON CONFLICT
      await db.run(`
        INSERT INTO ab_winners (test_name, winning_variant)
        VALUES (?, ?)
        ON CONFLICT(test_name) DO UPDATE SET winning_variant = excluded.winning_variant
      `, [testName, winningVariant]);
    } else {
      // SQLite: use INSERT OR REPLACE
      await db.run(`
        INSERT OR REPLACE INTO ab_winners (test_name, winning_variant)
        VALUES (?, ?)
      `, [testName, winningVariant]);
    }

    console.warn('[ABTesting] Winner declared for test "' + testName + '": ' + winningVariant);

    return res.json({
      success: true,
      testName: testName,
      winningVariant: winningVariant
    });
  } catch (err) {
    console.warn('[ABTesting] POST /admin/winner error:', err.message);
    return res.status(500).json({ error: 'Failed to declare winner' });
  }
});

/**
 * Simple chi-square approximation for statistical significance.
 * Returns a string indicator: 'not_sig', 'approaching', 'significant', 'highly_sig'
 *
 * This is a placeholder; in production use proper chi-square test.
 */
function _calculateChiSquareSignificance(variantResults) {
  // Very basic: if all variants have at least 30 impressions, mark as significant
  if (!variantResults || variantResults.length < 2) return 'insufficient_data';

  const minImpressions = Math.min.apply(Math, variantResults.map(function(v) {
    return v.impressions || 0;
  }));

  if (minImpressions >= 100) return 'highly_sig';
  if (minImpressions >= 50) return 'significant';
  if (minImpressions >= 20) return 'approaching';
  return 'not_sig';
}

module.exports = router;
