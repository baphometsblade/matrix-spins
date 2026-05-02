'use strict';

/**
 * games-seo.routes.js
 *
 * Server-rendered SEO landing pages for all 67 slot games.
 * Mounted at /games by server/index.js.
 *
 * Each page includes:
 *  - Full meta / OG / Twitter card tags
 *  - schema.org VideoGame + BreadcrumbList + WebPage structured data
 *  - Game details (RTP, volatility, provider, grid, bet range)
 *  - Play CTA -> lobby with game pre-selected
 *  - Related games grid (same provider / similar RTP)
 *  - FAQ accordion (5 common questions)
 *  - Internal links to category pages
 */

const express = require('express');
const router = express.Router();

const gamesModule = require('../../shared/game-definitions');
const games = Array.isArray(gamesModule) ? gamesModule : (gamesModule.games || []);
const gameMap = Object.fromEntries(games.map(g => [g.id, g]));

const VOL_LABEL = { low: 'Low', medium: 'Medium', 'medium-high': 'Medium-High', high: 'High' };
const VOL_COLOR = { low: '#22c55e', medium: '#f59e0b', 'medium-high': '#f97316', high: '#ef4444' };

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function rtpBar(rtp) {
    const pct = Math.min(100, Math.max(0, ((rtp - 92) / 7) * 100)).toFixed(1);
    const color = rtp >= 96 ? '#22c55e' : rtp >= 95 ? '#f59e0b' : '#ef4444';
    return `<div class="rtp-track"><div class="rtp-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

function relatedGames(game) {
    return games
        .filter(g => g.id !== game.id)
        .sort((a, b) => {
            const sa = a.provider === game.provider ? 0 : 1;
            const sb = b.provider === game.provider ? 0 : 1;
            if (sa !== sb) return sa - sb;
            return Math.abs(a.rtp - game.rtp) - Math.abs(b.rtp - game.rtp);
        })
        .slice(0, 6);
}

const STYLES = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e2e8f0;min-height:100vh;line-height:1.6}
a{color:#d4a843;text-decoration:none}a:hover{color:#f0c060}
.site-header{background:linear-gradient(135deg,#0f0f1a,#1a1000);border-bottom:1px solid #2a2000;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:60px;position:sticky;top:0;z-index:100}
.logo{font-size:20px;font-weight:800;background:linear-gradient(90deg,#d4a843,#f0c060);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.nav-links{display:flex;gap:16px;font-size:14px}.nav-links a{color:#a0a0b0}
.btn-nav{background:linear-gradient(135deg,#d4a843,#b8860b);color:#000!important;padding:8px 20px;border-radius:20px;font-weight:700;font-size:13px}
.hero{padding:60px 24px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:rgba(0,0,0,0.5)}
.hero-inner{position:relative;max-width:760px;margin:0 auto}
.game-img{width:140px;height:140px;border-radius:16px;object-fit:cover;border:3px solid rgba(212,168,67,0.4);box-shadow:0 8px 40px rgba(0,0,0,0.6);margin-bottom:24px}
.hero h1{font-size:clamp(26px,5vw,46px);font-weight:900;color:#fff;text-shadow:0 2px 20px rgba(0,0,0,0.8);margin-bottom:8px}
.hero-by{color:rgba(212,168,67,0.8);font-size:14px;margin-bottom:20px}
.tag-badge{display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;letter-spacing:1px;background:#d4a843;color:#000;margin-bottom:16px}
.btn-hero{display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#d4a843,#b8860b);color:#000;font-weight:900;font-size:18px;padding:16px 40px;border-radius:50px;border:none;cursor:pointer;text-decoration:none;box-shadow:0 4px 20px rgba(212,168,67,0.4);transition:transform .15s,box-shadow .15s;margin-bottom:12px}
.btn-hero:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(212,168,67,0.5);color:#000}
.hero-note{color:rgba(255,255,255,0.45);font-size:12px}
main{max-width:900px;margin:0 auto;padding:40px 24px}
.breadcrumb{font-size:13px;color:#6b7280;margin-bottom:32px}.breadcrumb a{color:#a0aec0}.breadcrumb span{color:#d4a843}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:40px}
.stat{background:linear-gradient(135deg,#12121e,#1a1a2e);border:1px solid #2a2a3e;border-radius:12px;padding:18px;text-align:center}
.stat-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:8px}
.stat-val{font-size:22px;font-weight:800;color:#d4a843}
.stat-sub{font-size:12px;color:#6b7280;margin-top:4px}
.rtp-track{height:6px;background:#1e1e2e;border-radius:3px;margin-top:8px;overflow:hidden}
.rtp-fill{height:100%;border-radius:3px}
section{margin-bottom:40px}
section h2{font-size:22px;font-weight:700;color:#d4a843;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #2a2000}
.about-text{color:#a0aec0;font-size:15px;line-height:1.8}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.feat{background:#12121e;border:1px solid #2a2a3e;border-radius:10px;padding:16px;display:flex;align-items:flex-start;gap:12px}
.feat-icon{font-size:24px;flex-shrink:0}
.feat h3{font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:4px}
.feat p{font-size:13px;color:#6b7280}
.faq-list{display:flex;flex-direction:column;gap:12px}
.faq-item{background:#12121e;border:1px solid #2a2a3e;border-radius:10px;overflow:hidden}
.faq-q{padding:16px;font-weight:600;color:#e2e8f0;font-size:15px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none}
.faq-q::after{content:'â–¸';color:#d4a843;transition:transform .2s}
.faq-item.open .faq-q::after{transform:rotate(90deg)}
.faq-a{padding:0 16px;max-height:0;overflow:hidden;color:#a0aec0;font-size:14px;line-height:1.7;transition:max-height .3s,padding .3s}
.faq-item.open .faq-a{max-height:200px;padding:0 16px 16px}
.rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.rel-card{background:#12121e;border:1px solid #2a2a3e;border-radius:10px;overflow:hidden;transition:transform .15s,border-color .15s;display:block}
.rel-card:hover{transform:translateY(-3px);border-color:#d4a843}
.rel-thumb{height:88px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.rel-thumb img{width:100%;height:100%;object-fit:cover}
.rel-info{padding:10px}
.rel-name{display:block;font-size:12px;font-weight:600;color:#e2e8f0;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rel-rtp{font-size:11px;color:#d4a843}
.cta-strip{background:linear-gradient(135deg,#1a1000,#2a1500);border:1px solid #d4a843;border-radius:16px;padding:40px;text-align:center;margin-top:40px}
.cta-strip h2{font-size:28px;font-weight:900;color:#d4a843;margin-bottom:8px}
.cta-strip p{color:#a0aec0;margin-bottom:24px}
.btn-cta{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#d4a843,#b8860b);color:#000;font-weight:900;font-size:16px;padding:14px 36px;border-radius:40px;text-decoration:none;transition:transform .15s}
.btn-cta:hover{transform:translateY(-2px);color:#000}
.site-footer{border-top:1px solid #1a1a2e;padding:24px;text-align:center;font-size:12px;color:#4a4a6a;margin-top:60px}
.site-footer a{color:#6b7280;margin:0 8px}
@media(max-width:600px){.stats-grid{grid-template-columns:1fr 1fr}.btn-hero{font-size:16px;padding:14px 28px}}
`;

function buildPage(game) {
    const name     = esc(game.name);
    const provider = esc(game.provider);
    const bonusDesc= esc(game.bonusDesc || 'Classic slot experience with exciting wins.');
    const vol      = game.volatility || 'medium';
    const volLabel = VOL_LABEL[vol] || vol;
    const volColor = VOL_COLOR[vol] || '#f59e0b';
    const rtp      = Number(game.rtp || 95).toFixed(2);
    const thumb    = esc(game.thumbnail || 'assets/thumbnails/classic_777.svg');
    const tag      = esc(game.tag || '');
    const grid     = game.gridCols ? `${game.gridCols}&times;${game.gridRows}` : '5&times;3';
    const winType  = esc(game.winType || 'payline');
    const minBet   = Number(game.minBet || 0.20).toFixed(2);
    const maxBet   = Number(game.maxBet || 5000).toFixed(2);
    const hasFree  = game.freeSpinsCount > 0;
    const freeSpins= game.freeSpinsCount || 0;

    const url   = `https://msaart.online/games/${game.id}`;
    const imgUrl= `https://msaart.online/${game.thumbnail}`;
    const title = `${game.name} Slot â€“ Play for Real Money | Matrix Spins`;
    const desc  = `Play ${game.name} by ${game.provider} at Matrix Spins. ${rtp}% RTP Â· ${volLabel} Volatility${hasFree ? ` Â· ${freeSpins} Free Spins` : ''} Â· Provably fair with instant AUD payouts.`;

    const schemaGame = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'VideoGame',
        name: game.name, description: game.bonusDesc || `${game.name} slot by ${game.provider}`,
        url, image: imgUrl,
        publisher: { '@type': 'Organization', name: game.provider },
        applicationCategory: 'Game', operatingSystem: 'Web Browser',
        offers: { '@type': 'Offer', priceCurrency: 'AUD', price: minBet,
            availability: 'https://schema.org/InStock', url }
    });
    const schemaBc = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home',      item: 'https://msaart.online' },
            { '@type': 'ListItem', position: 2, name: 'All Games', item: 'https://msaart.online/games' },
            { '@type': 'ListItem', position: 3, name: game.name,   item: url }
        ]
    });
    const schemaPage = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'WebPage',
        name: title, description: desc, url,
        isPartOf: { '@type': 'WebSite', name: 'Matrix Spins Casino', url: 'https://msaart.online' }
    });

    const rel = relatedGames(game).map(g => `
      <a href="/games/${esc(g.id)}" class="rel-card">
        <div class="rel-thumb" style="background:${esc(g.bgGradient||'linear-gradient(135deg,#1a1a2e,#16213e)')}">
          <img src="/${esc(g.thumbnail)}" alt="${esc(g.name)}" loading="lazy" onerror="this.style.display='none'">
        </div>
        <div class="rel-info">
          <span class="rel-name">${esc(g.name)}</span>
          <span class="rel-rtp">${Number(g.rtp).toFixed(1)}% RTP</span>
        </div>
      </a>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="${name} Slot | Matrix Spins">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${imgUrl}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Matrix Spins Casino">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${name} Slot | Matrix Spins">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${imgUrl}">
<script type="application/ld+json">${schemaGame}</script>
<script type="application/ld+json">${schemaBc}</script>
<script type="application/ld+json">${schemaPage}</script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${STYLES}</style>
</head>
<body>
<header class="site-header">
  <a href="/" class="logo">&#9670; Matrix Spins</a>
  <nav class="nav-links">
    <a href="/">Home</a>
    <a href="/games">Games</a>
    <a href="/promotions.html">Promos</a>
    <a href="/login.html" class="btn-nav">Play Now &rarr;</a>
  </nav>
</header>

<div class="hero" style="background:${esc(game.bgGradient||'linear-gradient(135deg,#1a1a2e,#16213e)')}">
  <div class="hero-inner">
    ${tag ? `<div class="tag-badge">${tag}</div><br>` : ''}
    <img class="game-img" src="/${thumb}" alt="${name}" onerror="this.style.background='#1a1a2e'">
    <h1>${name}</h1>
    <p class="hero-by">by ${provider}</p>
    <a href="/login.html?redirect=game:${esc(game.id)}" class="btn-hero">&#9654; Play ${name}</a>
    <p class="hero-note">18+ &middot; Gamble Responsibly &middot; T&amp;Cs Apply</p>
  </div>
</div>

<main>
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> &rsaquo; <a href="/games">All Games</a> &rsaquo; <span>${name}</span>
  </nav>

  <div class="stats-grid">
    <div class="stat">
      <div class="stat-lbl">Return to Player</div>
      <div class="stat-val">${rtp}%</div>
      ${rtpBar(Number(rtp))}
      <div class="stat-sub">Industry avg ~95%</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">Volatility</div>
      <div class="stat-val" style="color:${volColor};font-size:18px">${volLabel}</div>
      <div class="stat-sub">${vol === 'high' ? 'Big wins, less often' : vol === 'low' ? 'Frequent small wins' : 'Balanced gameplay'}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">Grid</div>
      <div class="stat-val">${grid}</div>
      <div class="stat-sub">${winType === 'cluster' ? 'Cluster pays' : winType === 'megaways' ? 'Megaways&trade;' : 'Payline wins'}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">Bet Range</div>
      <div class="stat-val" style="font-size:17px">$${minBet}&ndash;$${maxBet}</div>
      <div class="stat-sub">per spin</div>
    </div>
    ${hasFree ? `<div class="stat">
      <div class="stat-lbl">Free Spins</div>
      <div class="stat-val">${freeSpins}&times;</div>
      <div class="stat-sub">${game.freeSpinsRetrigger ? 'Retriggerable' : 'Standard bonus'}</div>
    </div>` : ''}
  </div>

  <section>
    <h2>About ${name}</h2>
    <p class="about-text">${bonusDesc}</p>
    <p class="about-text" style="margin-top:12px">
      ${name} is developed by <strong style="color:#d4a843">${provider}</strong> and available exclusively at Matrix Spins Casino.
      With a certified RTP of <strong style="color:#d4a843">${rtp}%</strong> and ${volLabel.toLowerCase()} volatility,
      this slot delivers ${vol === 'high' ? 'high-risk gameplay with the potential for massive wins' : vol === 'low' ? 'consistent payouts perfect for longer sessions' : 'a balanced mix of win frequency and prize size'}.
      All spins use provably fair SHA-256/HMAC randomness &mdash; every outcome is independently verifiable.
    </p>
  </section>

  <section>
    <h2>Game Features</h2>
    <div class="features">
      <div class="feat"><span class="feat-icon">&#128274;</span><div><h3>Provably Fair</h3><p>SHA-256 HMAC commit-reveal. Every spin independently verifiable.</p></div></div>
      ${hasFree ? `<div class="feat"><span class="feat-icon">&#127920;</span><div><h3>Free Spins</h3><p>${freeSpins} free spins on bonus trigger${game.freeSpinsRetrigger ? ' &mdash; retriggerable' : ''}.</p></div></div>` : ''}
      ${game.wildSymbol ? `<div class="feat"><span class="feat-icon">&#127183;</span><div><h3>Wild Symbol</h3><p>Substitutes for any paying symbol to complete wins.</p></div></div>` : ''}
      <div class="feat"><span class="feat-icon">&#9889;</span><div><h3>Instant Payouts</h3><p>AUD withdrawals processed 1&ndash;3 business days.</p></div></div>
      <div class="feat"><span class="feat-icon">&#128241;</span><div><h3>Mobile Ready</h3><p>Optimised for phone, tablet, and desktop.</p></div></div>
      <div class="feat"><span class="feat-icon">&#127873;</span><div><h3>Welcome Bonus</h3><p>50% deposit match up to $200 on first deposit.</p></div></div>
    </div>
  </section>

  <section>
    <h2>Frequently Asked Questions</h2>
    <div class="faq-list">
      <div class="faq-item">
        <div class="faq-q">What is the RTP of ${name}?</div>
        <div class="faq-a">${name} has a certified Return to Player (RTP) of ${rtp}%. For every $100 wagered over time, the game returns $${Number(rtp).toFixed(0)} on average. RTP is a long-term statistical measure and does not guarantee individual session returns.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">Can I play ${name} for free?</div>
        <div class="faq-a">Yes. Matrix Spins offers a demo mode with $1,000 in free credits so you can try ${name} risk-free. Visit the lobby without logging in to access demo mode immediately.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">Is ${name} provably fair?</div>
        <div class="faq-a">Absolutely. All live spins use SHA-256 HMAC commit-reveal: before each spin the server commits to a hashed outcome you can independently verify. No outcomes can be manipulated after commitment.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">What is the minimum bet for ${name}?</div>
        <div class="faq-a">You can play ${name} from $${minBet} per spin up to $${maxBet} per spin for high rollers. All bets are in Australian Dollars (AUD).</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">How do I claim the welcome bonus?</div>
        <div class="faq-a">Register a free account, make your first deposit of $5 or more, and receive a 50% deposit match up to $200 automatically. The bonus carries a 45&times; wagering requirement before withdrawal.</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Related Games You'll Love</h2>
    <div class="rel-grid">${rel}</div>
  </section>

  <div class="cta-strip">
    <h2>Ready to Spin?</h2>
    <p>Join Matrix Spins Casino &mdash; first deposit bonus: 50% match up to $200.</p>
    <a href="/signup.html" class="btn-cta">&#127920; Create Free Account</a>
  </div>
</main>

<footer class="site-footer">
  <div>
    <a href="/">Home</a>
    <a href="/games">All Games</a>
    <a href="/promotions.html">Promotions</a>
    <a href="/affiliates.html">Affiliates</a>
    <a href="/index.html#responsible">Responsible Gambling</a>
  </div>
  <div style="margin-top:12px">&copy; 2026 Matrix Spins Casino &middot; 18+ &middot; Gamble Responsibly &middot; <a href="/index.html#terms">T&amp;Cs Apply</a></div>
</footer>
<script>
document.querySelectorAll('.faq-q').forEach(function(q){
  q.addEventListener('click',function(){q.parentElement.classList.toggle('open');});
});
</script>
</body>
</html>`;
}

// GET /games  â€” index of all games
router.get('/', function(req, res) {
    const rows = games.map(g =>
        `<tr><td><a href="/games/${esc(g.id)}">${esc(g.name)}</a></td>` +
        `<td>${esc(g.provider)}</td>` +
        `<td>${Number(g.rtp).toFixed(2)}%</td>` +
        `<td>${VOL_LABEL[g.volatility]||g.volatility}</td>` +
        `<td>${g.gridCols?`${g.gridCols}&times;${g.gridRows}`:'5&times;3'}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>All ${games.length} Slot Games | Matrix Spins Casino</title>
<meta name="description" content="Browse all ${games.length} online slot games at Matrix Spins Casino. Filter by RTP, volatility and provider. Provably fair &middot; Instant AUD payouts.">
<link rel="canonical" href="https://msaart.online/games">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify({
    '@context':'https://schema.org','@type':'CollectionPage',
    name:`All ${games.length} Slot Games â€” Matrix Spins Casino`,
    url:'https://msaart.online/games',
    description:`${games.length} online slot games with provably fair RNG and instant AUD payouts.`,
    isPartOf:{type:'WebSite',name:'Matrix Spins Casino',url:'https://msaart.online'}
})}</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e2e8f0;padding:40px 24px}
a{color:#d4a843}a:hover{color:#f0c060}
h1{font-size:32px;font-weight:900;background:linear-gradient(90deg,#d4a843,#f0c060);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px}
p{color:#a0aec0;margin-bottom:24px;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{background:#1a1a2e;color:#d4a843;padding:10px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:1px}
td{padding:10px 14px;border-bottom:1px solid #1a1a2e}
tr:hover td{background:#12121e}
.back{color:#6b7280;font-size:13px}
</style>
</head>
<body>
<a href="/" class="back">&larr; Back to Matrix Spins</a>
<h1 style="margin-top:24px">All ${games.length} Slot Games</h1>
<p>Browse our complete provably fair slot library. Click any game for full details, RTP breakdown, and features.</p>
<table>
  <thead><tr><th>Game</th><th>Provider</th><th>RTP</th><th>Volatility</th><th>Grid</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(html);
});

// GET /games/:slug â€” individual game page
router.get('/:slug', function(req, res) {
    const game = gameMap[req.params.slug];
    if (!game) {
        return res.status(404).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Game Not Found | Matrix Spins</title>
<style>body{font-family:sans-serif;background:#0a0a0f;color:#e2e8f0;padding:60px;text-align:center}</style>
</head><body>
<h1 style="color:#d4a843">Game Not Found</h1>
<p style="color:#a0aec0;margin:16px 0">That slot doesn't exist. Browse all games below.</p>
<a href="/games" style="color:#d4a843">&larr; All Games</a> &nbsp;|&nbsp; <a href="/" style="color:#d4a843">Home</a>
</body></html>`);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(buildPage(game));
});

module.exports = router;
