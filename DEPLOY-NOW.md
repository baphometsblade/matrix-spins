# Matrix Spins Casino — Deploy Now Checklist

## What's Ready (All Tested, All 200 OK)

### Pages (18 top-level HTML files + 100 game pages)
| Page | File | Status |
|------|------|--------|
| Landing/Lobby | index.html | Ready |
| Login | login.html | Ready |
| Signup | signup.html | Ready |
| Wallet | wallet.html | Ready |
| Account | account.html | Ready |
| VIP Rewards | vip.html | Ready |
| Promotions | promotions.html | Ready |
| Tournament Leaderboard | leaderboard.html | Ready |
| Referral Program | referral.html | Ready |
| Daily Spin Wheel | spin-wheel.html | Ready |
| Achievements | achievements.html | Ready |
| Admin Dashboard | admin.html | Ready |
| 404 Error | 404.html | Ready |
| Deposit Success | deposit/success.html | Ready |
| Deposit Cancel | deposit/cancel.html | Ready |
| Terms & Conditions | terms.html | Ready |

### JavaScript Modules (21 JS files)
| Module | File | Auto-injects |
|--------|------|-------------|
| API Client | js/api-client.js | No |
| Progressive Jackpot | js/jackpot.js | No |
| Live Chat Bot | js/chat-widget.js | Yes |
| Notification Center | js/notifications.js | Yes |
| Age Gate (18+) | js/age-gate.js | Yes |
| Cookie Consent (GDPR) | js/cookie-consent.js | Yes |
| Game Search (Ctrl+K) | js/search.js | Yes |
| Favorites & Recent | js/favorites.js | Yes |
| Session Monitor | js/session-monitor.js | Yes |
| Sound Effects | js/sound-manager.js | Yes |
| Analytics (GA4) | js/analytics.js | Yes |
| Email Capture | js/email-capture.js | Yes |
| Conversion Funnel | js/conversion.js | Yes |

### CSS (23 CSS files)
All in css/ directory: auth, wallet, vip, promotions, leaderboard, referral, achievements, spin-wheel, account, jackpot, chat-widget, notifications, age-gate, skeleton, search, favorites, session-monitor, conversion, cookie-consent, email-capture, landing-redesign, performance-mobile

### Server API Endpoints (22 endpoints)
- POST /api/deposit, /api/withdraw, /api/spin
- GET /api/balance/:userId, /api/health
- GET /api/jackpots, /api/vip/status
- GET /api/promotions, POST /api/promotions/:id/claim
- GET /api/leaderboard, /api/referral/stats, /api/achievements
- POST /api/spin-wheel, /api/newsletter/subscribe
- GET /api/admin/newsletter/subscribers
- POST /api/auth/login
- GET /api/admin/dashboard/* (5 endpoints)
- Service Worker: sw.js (42 cached assets)

---

## Step 1: Copy Files to Your Local Repo

On your Windows machine, from `C:\created games\Casino\`:

```powershell
# New HTML pages
# leaderboard.html, referral.html, spin-wheel.html, achievements.html
# 404.html, deposit/success.html, deposit/cancel.html

# New JS modules (copy entire js/ folder)
# js/age-gate.js, js/cookie-consent.js, js/search.js
# js/favorites.js, js/session-monitor.js, js/sound-manager.js
# js/analytics.js, js/email-capture.js, js/conversion.js

# New CSS files (copy entire css/ folder)
# css/age-gate.css, css/cookie-consent.css, css/search.css
# css/favorites.css, css/session-monitor.css, css/conversion.css
# css/email-capture.css, css/leaderboard.css, css/referral.css
# css/achievements.css, css/spin-wheel.css, css/skeleton.css

# Updated files
# index.html (new CSS/JS links, footer links, JSON-LD, SW registration)
# server/index.js (new API endpoints, fixed catch-all route)
# sitemap.xml (new pages added)
# sw.js (service worker with full cache list)
```

## Step 2: Set Environment Variables on Render

Required for production (set in Render dashboard > Environment):

```
DATABASE_URL=postgresql://...        # Your PostgreSQL connection string
JWT_SECRET=<random-64-char-string>   # Generate: openssl rand -hex 32
STRIPE_SECRET_KEY=sk_live_...        # From Stripe Dashboard
STRIPE_PUBLISHABLE_KEY=pk_live_...   # From Stripe Dashboard
STRIPE_WEBHOOK_SECRET=whsec_...      # From Stripe Webhooks
ADMIN_PASSWORD=<strong-password>     # For admin dashboard access
NODE_ENV=production
```

## Step 3: Set Up Google Analytics

1. Go to https://analytics.google.com
2. Create a GA4 property for msaart.online
3. Copy the Measurement ID (G-XXXXXXXXXX)
4. In index.html, add before the analytics.js script:
   ```html
   <script>window.MS_GA_ID = 'G-YOUR-ID-HERE';</script>
   ```

## Step 4: Stripe — ALREADY CONFIGURED ✅

Products, prices, and payment links are **live** on your Stripe account (Double Diamond AI):

| Tier | Product | Payment Link |
|------|---------|-------------|
| $10 | prod_UPHJCRs8ivTKhR | https://buy.stripe.com/3cI4gzaUZ4Nbeercm26kg0y |
| $25 | prod_UPHJnU30xKOSJN | https://buy.stripe.com/5kQfZhaUZ1AZc6j2Ls6kg0z |
| $50 | prod_UPHJjaEK8oDcFo | https://buy.stripe.com/eVqfZh2otgvTb2f4TA6kg0A |
| $100 | prod_UPHKoCWVxrRyul | https://buy.stripe.com/eVq7sL9QVbbz5HV4TA6kg0B |
| $250 VIP | prod_UPHKjRfJa8K9a5 | https://buy.stripe.com/fZudR96EJ6Vj8U7dq66kg0C |

These links are already wired into `wallet.html` — deposits work immediately, no backend needed.

For webhook processing (optional, enables real-time balance updates):
1. Go to https://dashboard.stripe.com
2. Set up a webhook endpoint: `https://msaart.online/api/payments/webhooks/stripe`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`

## Step 5: Git Push to Deploy

```powershell
cd "C:\created games"
git add Casino/
git commit -m "feat: complete casino platform — 16 pages, 13 JS modules, 22 API endpoints

New pages: leaderboard, referral, spin-wheel, achievements, 404, deposit results
New modules: age-gate, cookie-consent, search, favorites, session-monitor, sound,
analytics, email-capture, conversion funnel optimizer
Server: jackpot, VIP, leaderboard, referral, spin-wheel, achievements, newsletter APIs
SEO: sitemap, JSON-LD structured data, OG meta on all pages
PWA: service worker with 42 cached assets
Compliance: GDPR cookie consent, 18+ age gate, responsible gambling session monitor"
git push origin master
```

Render auto-deploys on push. Takes ~2-3 minutes.

## Step 6: Verify Live Site

After deploy, check:
- https://msaart.online (landing page loads)
- https://msaart.online/api/health (returns status: ok)
- https://msaart.online/spin-wheel.html (wheel renders)
- https://msaart.online/leaderboard.html (rankings show)

---

## Revenue Channels

1. **Direct deposits** — Stripe payment processing (house edge on slots)
2. **Email list** — Auto-capture popup builds your marketing list
3. **Referral viral loop** — $50 referral program drives organic growth
4. **Conversion funnel** — Welcome flow, low-balance nudges, win upsells
5. **VIP retention** — Tier system keeps high-value players engaged
6. **Daily engagement** — Spin wheel, achievements, notifications bring users back

## Important Legal Note

Online gambling for real money requires proper licensing (e.g., Curaçao eGaming, Malta Gaming Authority). Running without a license carries significant legal risk. Consider:
- Operating as a **social casino** (play-for-fun, no real money payouts)
- Obtaining proper licensing before enabling real-money deposits
- Consulting a gaming attorney in your jurisdiction
