# Irium Marketplace

A static, read-only web app that aggregates OTC sell offers from multiple `iriumd` nodes. No accounts, no server, no order book — pure peer discovery.

---

## How It Works

1. Node operators publish offer feeds at `GET /offers/feed` on their running `iriumd` instance
2. They submit their feed URL via the **Submit Feed** page
3. The marketplace fetches all registered feed URLs client-side at browse time
4. Offers from all feeds are merged, deduplicated, and displayed

All fetching happens in the browser — there is no backend. Failed feeds are shown as "Feed unavailable" banners; successful feeds continue loading regardless.

---

## Architecture

```
irium-marketplace/
├── src/
│   ├── App.tsx             # Dark header nav, lazy routes, AnimatePresence
│   ├── feeds.json          # Array of registered feed URLs
│   ├── lib/
│   │   └── types.ts        # FeedOffer, FeedResult, fetchFeed()
│   └── pages/
│       ├── Landing.tsx     # Hero, 3-step explainer, CTA
│       ├── Browse.tsx      # Offer grid, filters, feed error banners
│       ├── OfferDetail.tsx # Full offer details + CLI command
│       ├── SubmitFeed.tsx  # Feed URL submission form
│       └── About.tsx       # How it works, HTLC security, feed format
└── package.json
```

---

## Feed Format

Each feed URL must return JSON in this format:

```json
{
  "count": 5,
  "exported_at": 1777648997,
  "offers": [
    {
      "offer_id": "d1-gossip-t4",
      "seller_address": "Q9KxBRfr...",
      "seller_pubkey": "03e918af...",
      "amount_irm": 100000000,
      "payment_method": "bank-transfer",
      "status": "open",
      "timeout_height": 25000,
      "created_at": 1777624133
    }
  ]
}
```

**Requirements:**
- Publicly accessible (no authentication)
- Returns valid Irium feed JSON
- CORS header: `Access-Control-Allow-Origin: *`
- HTTPS strongly recommended

---

## Adding Feeds

Edit `src/feeds.json` to add feed URLs to the default index:

```json
[
  "https://node1.iriumlabs.com/offers/feed",
  "https://node2.irium.network/offers/feed"
]
```

In production, a backend API would store submitted URLs — the `SubmitFeed` form is wired to POST to an indexer API endpoint (currently a mock).

---

## Browsing Offers

The Browse page fetches all feeds in parallel using `Promise.allSettled()`. For each feed:
- **Success**: offers are added to the grid
- **Failure**: a dismissable "Feed unavailable" banner is shown

Filters available:
- Payment method (bank-transfer, cash, crypto, other)
- Amount range (min/max IRM)
- Sort by (newest, oldest, amount high/low)

---

## Taking an Offer

Offers cannot be taken directly from the marketplace — this is intentional. The OfferDetail page shows a CLI command:

```bash
irium-wallet offer-take --offer d1-gossip-t4 --buyer <YOUR_ADDRESS>
```

The buyer runs this command with their own `irium-wallet` CLI, which:
1. Creates an on-chain agreement
2. Funds the HTLC escrow
3. Notifies the seller

---

## HTLC Security

Every Irium OTC trade uses a Hash Time-Locked Contract:

- The seller locks IRM on-chain
- Funds release only if the seller reveals a secret preimage (after receiving payment)
- If `timeout_height` is reached without release, the seller reclaims their IRM

This means sellers cannot steal — they either release (post-payment) or refund (post-timeout). Buyers who pay but don't receive release have on-chain evidence the payment wasn't honoured.

---

## Deployment

```bash
npm run build        # outputs to dist/
```

The `dist/` folder is a fully static site. Deploy to any static host (GitHub Pages, Cloudflare Pages, Netlify, S3, etc.). No server-side rendering required.
