# Irium Web Wallet

A browser-based wallet interface that connects directly to a running `iriumd` node via its HTTP API. No accounts, no custody, no server.

---

## Architecture

```
irium-web-wallet/
├── src/
│   ├── App.tsx             # BrowserRouter, AppLayout, polling loop, Toaster
│   ├── lib/
│   │   ├── api.ts          # fetch client — proxies /api/* → iriumd :38300
│   │   ├── store.ts        # Zustand — node status, balance, notifications
│   │   ├── types.ts        # Shared types + formatIRM, SATS_PER_IRM
│   │   └── qr.ts           # QR code generator (no dependencies) + downloadQR()
│   ├── components/
│   │   ├── Sidebar.tsx     # Nav links
│   │   └── TopBar.tsx      # Page title, node status, notification bell
│   └── pages/
│       ├── Dashboard.tsx   # Node overview, charts
│       ├── Wallet.tsx      # Address lookup, balance, QR receive, tx history
│       ├── Settlement.tsx  # 4-template agreement wizard
│       ├── Agreements.tsx  # List + detail view
│       ├── Marketplace.tsx # Offer feed browser
│       └── Reputation.tsx  # Reputation scores
└── vite.config.ts          # /api proxy → http://127.0.0.1:38300
```

---

## Running Locally

```bash
# Prerequisites: iriumd running on port 38300
npm install
npm run dev        # → http://localhost:5173
npm run build      # production static files in dist/
```

### Connecting to a Remote Node

Set `VITE_API_BASE` to your node's URL before building:

```bash
VITE_API_BASE=https://mynode.example.com:38300 npm run build
```

Or configure the Vite proxy target in `vite.config.ts` for dev.

---

## Pages

### Dashboard
Real-time node status, peer count, network era, block height. Balance chart over time.

### Wallet
- **Address lookup**: Enter any Irium address to view balance and history
- **Receive**: Shows QR code of the entered address with Copy and Download SVG buttons
- **Transaction history**: Incoming UTXOs with block height and amounts

### Settlement Hub
Four HTLC agreement templates — identical functionality to the desktop wallet. Offline-mode warning when `nodeOnline === false`. Live preview card updates as fields change. Success screen shows the real `agreement_id` returned by the node.

### Notification Bell (TopBar)
Persistent notification panel — `addNotification()` from any page, dismiss per item or clear all. Badge shows unread count.

---

## API Client

`src/lib/api.ts` exports a single `api` object. All methods use a 5-second timeout for GET requests and 10 seconds for POST:

```ts
api.getStatus()                     // GET /status
api.getBalance(address)             // GET /rpc/balance?address=...
api.getHistory(address)             // GET /rpc/history?address=...
api.getFeeEstimate()                // GET /rpc/fee_estimate
api.listAgreements()                // GET /agreements
api.createOtc(params)              // POST /settlement/otc
api.createFreelance(params)        // POST /settlement/freelance
api.createMilestone(params)        // POST /settlement/milestone
api.createDeposit(params)          // POST /settlement/deposit
```

---

## QR Code

`src/lib/qr.ts` contains a full ISO/IEC 18004 QR code generator (versions 1–10, EC level M). No external libraries.

```ts
import { QRCode, downloadQR } from '../lib/qr';

// React component
<QRCode value="irm1abc..." size={200} />

// Download as SVG
downloadQR("irm1abc...", "my-address.svg");
```

---

## Notifications

```ts
import { useStore } from '../lib/store';

const addNotification = useStore(s => s.addNotification);

addNotification({ type: 'success', title: 'Sent!', message: 'tx confirmed in block 12345' });
addNotification({ type: 'error',   title: 'Failed', message: 'Node offline' });
```

Types: `success` | `error` | `warning` | `info`

---

## CORS

When running the web wallet against a remote node, the node must have CORS enabled:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Content-Type
```

For local development, the Vite proxy handles this automatically.
