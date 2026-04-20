# Deploy runbook — Matrix Spins

Precise steps to take this from a clone to taking real money.

## 0. Prerequisites

- A Stripe account approved for your product category. If your application is rejected for "unauthorized digital goods" (common with NFT sales), you'll need a provider like Crossmint or thirdweb Engine that runs their own merchant of record in front of Stripe.
- A Render account (or any Node 20 host + managed Postgres).
- A domain pointed at your host. HTTPS is mandatory — Stripe webhooks will not sign over plaintext, and browsers block mixed content.

## 1. Rotate the leaked admin password

Earlier commits had `ADMIN_PASSWORD: "coda1985"` in `render.yaml`. That value is in git history on `main`.

- Set a new `ADMIN_PASSWORD` in the Render dashboard (not in `render.yaml`).
- If this repo is ever going public, rewrite history with `git filter-repo --replace-text` to scrub the literal string, or consider the password permanently burned.

## 2. Set env vars in Render

Open your service → Environment and add each of:

| Name | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `JWT_SECRET` | yes | 32+ random bytes. Render can `generateValue` it for you. |
| `ADMIN_PASSWORD` | yes | Rotate on a schedule. |
| `PUBLIC_URL` | yes | e.g. `https://msaart.online`. Stripe `success_url` / `cancel_url` use this. |
| `ALLOWED_ORIGIN` | yes | Same origin; CORS is locked to it in production. |
| `DATABASE_URL` | recommended | Postgres connection string. Without this, SQLite is used on ephemeral disk — users and balances vanish on every redeploy. |
| `STRIPE_SECRET_KEY` | yes (for deposits) | `sk_live_…` in production. `sk_test_…` for staging. |
| `STRIPE_PUBLISHABLE_KEY` | yes | `pk_live_…`. Currently used only by the frontend. |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…`. The webhook handler refuses to run without it. |
| `NFT_SIGNING_SECRET` | yes | 32+ random bytes. If omitted, receipts signed in one boot can't be verified after a restart. |
| `NFT_PROVIDER` | optional | Defaults to `db`. Change when you wire a real chain. |
| `MAINTENANCE_MODE` | optional | `1` to block the API except health/login/admin. |

## 3. Create the Stripe webhook endpoint

In the Stripe Dashboard → Developers → Webhooks:

1. Add endpoint `https://<your-domain>/api/payment/stripe/webhook`.
2. Subscribe to these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `charge.dispute.funds_withdrawn`
3. Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` on Render.
4. Redeploy so the env var is picked up.

## 4. First transaction test

Use Stripe's test mode first. With `STRIPE_SECRET_KEY=sk_test_…`:

1. Register a new account on your deployed site.
2. Click Deposit, pick $25.
3. Stripe redirects you to its hosted checkout.
4. Use test card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
5. After returning to the site you should see:
   - A confirming toast "Confirming your deposit…".
   - It flips to "Deposit Successful · $25.00 credited … Receipt NFT minted: bronze · msr_…" once the webhook arrives.
   - Balance reflects the deposit.
   - The NFT gallery (`_showNFTGallery`) shows the new receipt.

If the confirmation toast sticks on "Confirming", check:
- `/api/health` → `stripe: configured`, `webhookSecret: configured`.
- Stripe Dashboard → Webhooks → your endpoint → "Recent deliveries" shows 200s.
- Server logs for `[stripe-webhook] deposit N fulfilled …`.

## 5. Switching to live mode

- Replace `sk_test_…` / `pk_test_…` / `whsec_…` with the live versions.
- Re-subscribe the Stripe webhook to the same event list in the live environment.
- Run one small live test (e.g. your own card, refund yourself afterwards) and confirm:
  - Refund webhook decrements balance.
  - `deposits.status` flips to `refunded` or `partial_refund`.
  - Receipt is retained (refunded receipts stay visible; surface this to users however you prefer).

## 6. Post-deploy smoke tests

```bash
curl -sf https://<your-domain>/api/health
# expect: {"status":"ok","database":"pg","stripe":"configured","webhookSecret":"configured", …}

# The webhook endpoint must refuse unsigned traffic in production:
curl -sS -X POST https://<your-domain>/api/payment/stripe/webhook \
  -H 'Content-Type: application/json' --data '{"type":"test"}'
# expect: "Invalid signature."
```

## 7. What is not yet wired

These are intentional gaps that need a product/operational decision, not code:

- **On-chain minting.** `server/services/nft.service.js :: mintFor()` is the only function to change. Pick a provider (Crossmint, thirdweb Engine), deploy or use an existing ERC-721 contract, drop the API key in env, replace the body.
- **Withdrawals.** No code path credits the user's real bank. This is deliberate: wiring a payout flow usually moves the operation into money-transmission regulation, which is out of scope here.
- **Real on-chain crypto deposits.** The old stubs were removed. If you want MetaMask / WalletConnect deposits, wire ethers.js + a real on-chain check against `CRYPTO_WALLET_ADDRESS` and verify via Alchemy / Infura. Not started.
- **KYC.** The only age gate is DOB at registration. Real KYC (document upload, identity verification) is a separate integration (Persona, Veriff, Onfido).

## 8. Running locally

```bash
npm install
cp .env.example .env
# set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET if you want to test paid deposits
npm run dev          # starts server on :3000 without rebuilding the frontend bundle
```

The first boot creates `server/data.sqlite` with the full schema. Delete that file to reset the DB.

To test webhooks locally, use `stripe listen --forward-to localhost:3000/api/payment/stripe/webhook` from the Stripe CLI. It prints a `whsec_…` value — put that in your `.env` as `STRIPE_WEBHOOK_SECRET`.
