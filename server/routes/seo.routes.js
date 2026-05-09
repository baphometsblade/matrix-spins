/**
 * SEO routes — dynamic sitemap.xml + robots.txt + structured data feed.
 *
 * The static /sitemap.xml file in the repo is kept as a build-time fallback;
 * this route generates a fresh, real sitemap on every request based on:
 *   - canonical public pages
 *   - the live game catalog from shared/game-definitions.js
 *
 * Cached for 1 hour to keep crawler-friendly without hammering the file
 * system on every request.
 */
'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();

const HOST = (process.env.SITE_HOST || 'https://msaart.online').replace(/\/$/, '');

// ── Static, hand-curated public pages with their crawl priority ──
const STATIC_PAGES = [
  { url: '/',                          priority: '1.0', freq: 'daily'   },
  { url: '/promotions.html',           priority: '0.9', freq: 'daily'   },
  { url: '/vip.html',                  priority: '0.8', freq: 'weekly'  },
  { url: '/tournaments.html',          priority: '0.8', freq: 'daily'   },
  { url: '/leaderboard.html',          priority: '0.7', freq: 'daily'   },
  { url: '/spin-wheel.html',           priority: '0.6', freq: 'weekly'  },
  { url: '/affiliates.html',           priority: '0.6', freq: 'monthly' },
  { url: '/referral.html',             priority: '0.6', freq: 'monthly' },
  { url: '/faq.html',                  priority: '0.6', freq: 'monthly' },
  { url: '/provably-fair.html',        priority: '0.6', freq: 'monthly' },
  { url: '/responsible-gambling.html', priority: '0.5', freq: 'monthly' },
  { url: '/terms.html',                priority: '0.4', freq: 'yearly'  },
  { url: '/privacy.html',              priority: '0.4', freq: 'yearly'  },
  { url: '/login.html',                priority: '0.5', freq: 'yearly'  },
  { url: '/signup.html',               priority: '0.7', freq: 'yearly'  },
];

let _gameSlugsCache = null;
function loadGameSlugs() {
  if (_gameSlugsCache) return _gameSlugsCache;
  try {
    const games = require(path.join(__dirname, '..', '..', 'shared', 'game-definitions.js'));
    const list = Array.isArray(games) ? games : (games.GAMES || games.games || []);
    _gameSlugsCache = list
      .map(g => g && (g.slug || g.id))
      .filter(Boolean);
  } catch (err) {
    console.warn('[SEO] game-definitions load failed:', err.message);
    _gameSlugsCache = [];
  }
  return _gameSlugsCache;
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}

// ── /sitemap.xml ────────────────────────────────────────────────
router.get('/sitemap.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  for (const p of STATIC_PAGES) {
    lines.push(
      `<url><loc>${xmlEscape(HOST + p.url)}</loc>` +
      `<lastmod>${today}</lastmod>` +
      `<changefreq>${p.freq}</changefreq>` +
      `<priority>${p.priority}</priority></url>`
    );
  }

  const slugs = loadGameSlugs();
  for (const slug of slugs) {
    lines.push(
      `<url><loc>${xmlEscape(HOST + '/games/' + slug + '.html')}</loc>` +
      `<lastmod>${today}</lastmod>` +
      `<changefreq>weekly</changefreq>` +
      `<priority>0.8</priority></url>`
    );
  }

  lines.push('</urlset>');
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.send(lines.join('\n'));
});

// ── /robots.txt ─────────────────────────────────────────────────
router.get('/robots.txt', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send([
    'User-agent: *',
    'Allow: /',
    '',
    '# Sensitive — never index',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /admin.html',
    'Disallow: /admin/',
    'Disallow: /deposit/',
    'Disallow: /account.html',
    'Disallow: /wallet.html',
    'Disallow: /bonus-history.html',
    'Disallow: /history.html',
    'Disallow: /jackpot-history.html',
    '',
    '# Crawl politely',
    'Crawl-delay: 1',
    '',
    `Sitemap: ${HOST}/sitemap.xml`,
    ''
  ].join('\n'));
});

// ── /api/seo/structured-data — Organization + WebSite + Casino schemas ──
// Used by lobby pages to embed rich JSON-LD. Cached aggressively.
router.get('/api/seo/structured-data', (req, res) => {
  const slugs = loadGameSlugs();

  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Matrix Spins',
    legalName: 'Matrix Spins Casino',
    url: HOST,
    logo: HOST + '/img/og-banner.png',
    foundingDate: '2026',
    description:
      'Premium online casino with 100 provably-fair slot games from 8 world-class studios.',
    sameAs: [],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: ['English'],
      areaServed: 'Worldwide'
    }
  };

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Matrix Spins Casino',
    url: HOST,
    description: 'Play 100 premium slot games. Provably fair, instant payouts, no download.',
    inLanguage: 'en-US',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: HOST + '/?q={search_term_string}'
      },
      'query-input': 'required name=search_term_string'
    }
  };

  const games = slugs.slice(0, 50).map(slug => ({
    '@context': 'https://schema.org',
    '@type': 'Game',
    name: slug.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' '),
    url: HOST + '/games/' + slug + '.html',
    genre: 'Slot Game',
    gamePlatform: ['Web Browser', 'Mobile'],
    applicationCategory: 'Game',
    publisher: { '@type': 'Organization', name: 'Matrix Spins' }
  }));

  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    organization,
    website,
    games,
    generatedAt: new Date().toISOString(),
    totalGames: slugs.length
  });
});

module.exports = router;
