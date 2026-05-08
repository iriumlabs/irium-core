# Irium Mobile Wallet

A Capacitor-based iOS/Android wallet app built on the same React + TypeScript stack as the web wallet. Connects to any `iriumd` node via configurable RPC URL.

---

## Architecture

```
irium-mobile/
├── src/
│   ├── App.tsx             # AnimatePresence routing (x-axis slide), NotificationBanner
│   ├── lib/
│   │   ├── api.ts          # fetch client — reads RPC URL from localStorage
│   │   ├── store.ts        # Zustand — node status, balance, offers, notifications
│   │   ├── types.ts        # Shared types
│   │   ├── errors.ts       # getUserMessage()
│   │   └── qr.ts           # QR code generator + QRCode component (no deps)
│   ├── hooks/
│   │   └── useDeepLink.ts  # irium:// URL scheme handler via @capacitor/app
│   ├── components/
│   │   └── TabBar.tsx      # 5-tab bottom nav with haptic feedback
│   └── screens/
│       ├── Splash.tsx      # Logo + animated pulse, auto-navigates after check
│       ├── Home.tsx        # Balance, recent transactions, node status
│       ├── Send.tsx        # Send form with address + amount validation
│       ├── Receive.tsx     # QR code of own address + Share via Capacitor Share
│       ├── Marketplace.tsx # Offer feed from configured node
│       ├── Agreements.tsx  # Active agreements list
│       └── Settings.tsx    # RPC URL, clear data, about
├── capacitor.config.ts
└── package.json
```

---

## Running

```bash
npm install

# Web preview
npm run dev

# iOS
npx cap add ios
npx cap run ios

# Android
npx cap add android
npx cap run android
```

---

## Navigation

Screens use React Router with framer-motion `AnimatePresence` (x±40px slide transitions). The TabBar manages 5 tabs:

| Tab | Screen | Icon |
|-----|--------|------|
| Home | `/home` | Home |
| Send | `/send` | ArrowUpRight |
| Receive | `/receive` | ArrowDownLeft |
| Market | `/marketplace` | ShoppingBag |
| Settings | `/settings` | Settings |

Tapping a tab triggers `@capacitor/haptics` `ImpactStyle.Light`.

---

## Deep Links

The app registers the `irium://` URL scheme. Incoming URLs are parsed by `parseDeepLink()` in `src/hooks/useDeepLink.ts`:

| URL | Navigates to |
|-----|-------------|
| `irium://send?to=Q9K...&amount=5000000` | Send screen, pre-fills address and amount |
| `irium://receive` | Receive screen |
| `irium://agreement/abc-123` | Agreements screen, opens agreement `abc-123` |
| `irium://offer/d1-gossip-t4` | Marketplace screen, highlights offer |
| `irium://node?rpc=http%3A%2F%2F...` | Settings screen, sets RPC URL |

To register the scheme, add to `capacitor.config.ts`:

```ts
ios: { scheme: 'irium' },
android: { scheme: 'irium' },
```

And add the intent filter to `AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="irium"/>
</intent-filter>
```

---

## Connecting to a Node

The RPC URL is stored in `localStorage` under the key `iriumRpcUrl`. The default is `http://127.0.0.1:38300`. To connect to a remote node, go to **Settings** and update the URL.

All API requests read this value at call time — changing it in Settings takes effect immediately for the next request.

---

## Notifications

Notifications are stored in the Zustand store. The `NotificationBanner` component slides down from the top of the screen when a new notification arrives and auto-dismisses after 3 seconds:

```ts
const addNotification = useStore(s => s.addNotification);
addNotification({ type: 'success', title: 'Sent!', message: 'tx in block 12345' });
```

---

## QR Code — Receive Screen

The Receive screen shows a QR code of the wallet address generated entirely in-app (no external library). The **Share Address** button uses `@capacitor/share` to invoke the native share sheet:

```ts
import { Share } from '@capacitor/share';
await Share.share({ title: 'My Irium Address', text: address });
```

---

## Capacitor Plugins Used

| Plugin | Use |
|--------|-----|
| `@capacitor/haptics` | Tab bar tap feedback |
| `@capacitor/share` | Share address from Receive screen |
| `@capacitor/clipboard` | Copy address/txid |
| `@capacitor/app` | Deep link `appUrlOpen` event |
