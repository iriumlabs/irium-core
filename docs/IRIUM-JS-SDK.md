# Irium JavaScript SDK

Reference for integrating with the Irium node HTTP API from JavaScript/TypeScript. The patterns used in this codebase (desktop wallet, web wallet, mobile) are collected here for reuse.

---

## Node HTTP API

All `iriumd` nodes expose an HTTP API on port `38300` by default.

### Base URL

```
http://127.0.0.1:38300        (local)
https://yournode.example.com  (remote, requires CORS)
```

---

## Endpoints

### Node Status

```
GET /status
```

```ts
interface NodeStatus {
  running:       boolean;
  height:        number;
  peers:         number;
  synced:        boolean;
  network_era:   string;    // e.g. "genesis"
  peer_count:    number;
  anchor_loaded: boolean;
}
```

### Wallet Balance

```
GET /rpc/balance?address=<address>
```

```ts
interface WalletBalance {
  address:       string;
  balance:       number;   // total sats
  confirmed:     number;
  unconfirmed:   number;
  mined_balance: number;
  utxo_count:    number;
}
```

### Transaction History

```
GET /rpc/history?address=<address>
```

Returns `{ txs: TxEntry[] }` where:

```ts
interface TxEntry {
  txid:         string;
  height:       number;
  output_value: number;    // sats
  is_coinbase:  boolean;
  timestamp:    number;
}
```

### Fee Estimate

```
GET /rpc/fee_estimate
```

```ts
interface FeeEstimate {
  sat_per_byte:   number;
  estimated_size: number;
  total_fee:      number;
}
```

### Offer Feed

```
GET /offers/feed
```

Returns the local node's open offers:

```ts
interface OfferFeed {
  count:       number;
  exported_at: number;
  offers:      FeedOffer[];
}
```

---

## Settlement API

All settlement endpoints accept a `template` discriminant and return an `AgreementResult`.

```ts
interface AgreementResult {
  agreement_id: string;
  hash?:        string;
  status:       string;
}
```

### OTC Agreement

```
POST /settlement/otc
```

```ts
interface OtcParams {
  seller_address: string;
  buyer_address:  string;
  amount_irm:     number;
  payment_method: string;
  timeout_blocks: number;
}
```

### Freelance Agreement

```
POST /settlement/freelance
```

```ts
interface FreelanceParams {
  contractor_address: string;
  client_address:     string;
  amount_irm:         number;
  deliverable:        string;
  deadline_blocks:    number;
}
```

### Milestone Agreement

```
POST /settlement/milestone
```

```ts
interface MilestoneParams {
  contractor_address: string;
  client_address:     string;
  amount_irm:         number;
  milestone_count:    number;
  description:        string;
  deadline_blocks:    number;
}
```

### Deposit Agreement

```
POST /settlement/deposit
```

```ts
interface DepositParams {
  depositor_address: string;
  recipient_address: string;
  amount_irm:        number;
  lock_blocks:       number;
  memo?:             string;
}
```

---

## Minimal Fetch Client

```ts
const BASE = 'http://127.0.0.1:38300';

async function get<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
```

---

## Unit Conversion

Irium amounts are always stored in **satoshis** (integer). 1 IRM = 100,000,000 sats.

```ts
const SATS_PER_IRM = 100_000_000;

function formatIRM(sats: number): string {
  return `${(sats / SATS_PER_IRM).toFixed(4)} IRM`;
}

function IRMToSats(irm: number): number {
  return Math.round(irm * SATS_PER_IRM);
}
```

---

## QR Code Generation

A full QR code generator is available at `src/lib/qr.ts` in both the web wallet and mobile app. No external dependencies.

```ts
import { QRCode, downloadQR, generateQR } from './lib/qr';

// React SVG component
<QRCode value="irm1abc..." size={200} />

// Download as SVG file
downloadQR("irm1abc...", "address.svg");

// Raw boolean matrix
const matrix: boolean[][] = generateQR("irm1abc...");
```

Supports versions 1–10, Error Correction Level M, all 8 mask patterns with penalty scoring.

---

## Error Messages

```ts
import { getUserMessage } from './lib/errors';

try {
  await api.getStatus();
} catch (e) {
  const msg = getUserMessage(e);
  // "Network error — check your node connection."
  // "Request timed out. Is the node running?"
  // "HTLC error — check escrow parameters."
}
```

`getUserMessage` maps common error conditions to user-facing strings. Falls back to `error.message` for unknown errors.
