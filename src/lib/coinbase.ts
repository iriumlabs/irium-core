// ─── Coinbase reward-distribution decoder (display-only) ─────────────────────
//
// Irium Core talks to iriumd's /rpc/block directly, which returns the raw
// coinbase transaction as tx_hex[0] but does NOT pre-decode its outputs. This
// module decodes that raw coinbase entirely client-side so the Explorer's
// block modal can show an honest reward-distribution breakdown. It touches no
// consensus/node code — it only PARSES bytes that iriumd already produced.
//
// The decode is byte-for-byte compatible with the reference decoder
// deploy-monitor/cbdecode.py (verified against real mainnet blocks), and the
// address encoder reproduces iriumd's own base58check scheme (version byte
// 0x39 + double-SHA256 checksum) — proven by the fact that the decoded PRIMARY
// payout address equals the node-reported miner_address for the same block.
//
// Role model (PoAW-X): the first four P2PKH coinbase outputs are, in vout
// order, PRIMARY (55%), COMPUTE (22%), VERIFY (13%) and SUPPORT (10%) of the
// block reward. Today all four typically pay the SAME pool address (they simply
// repeat); if a future change pays DISTINCT addresses, each row already carries
// its own decoded address and renders correctly with no further work.

export interface RewardRow {
  vout: number
  /** Human role label, e.g. "Primary", "Data", "Output 6". */
  role: string
  /** Reward-share percentage for the four role outputs; null otherwise. */
  pct: string | null
  /** "p2pkh" | "op_return" | "irium_data" | "unknown". */
  scriptType: string
  /** Recipient address (P2PKH outputs) or null for data/commitment outputs. */
  address: string | null
  /** Payout value in satoshis (1 IRM = 100_000_000 sats). */
  valueSats: number
}

// ── pure-JS SHA-256 (no deps, no async/secure-context requirement) ───────────
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

function sha256(msg: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const l = msg.length
  const withOne = l + 1
  const pad = (56 - (withOne % 64) + 64) % 64
  const total = withOne + pad + 8
  const buf = new Uint8Array(total)
  buf.set(msg, 0)
  buf[l] = 0x80
  const dv = new DataView(buf.buffer)
  const bitLen = l * 8
  dv.setUint32(total - 4, bitLen >>> 0)
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000))
  const w = new Uint32Array(64)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }
  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4, h5, h6, h7].forEach((hh, i) => odv.setUint32(i * 4, hh >>> 0))
  return out
}
const sha256d = (b: Uint8Array) => sha256(sha256(b))

// ── base58check address encoding (Irium P2PKH version byte 0x39) ─────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const IRIUM_P2PKH_VERSION = 0x39

function base58(bytes: Uint8Array): string {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  const digits: number[] = [0]
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      const x = digits[j] * 256 + carry
      digits[j] = x % 58
      carry = (x / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let s = ''
  for (let i = 0; i < zeros; i++) s += '1'
  for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]]
  return s
}

/** Encode a 20-byte public-key hash into an Irium base58check address. */
export function pkhToAddress(pkh: Uint8Array): string {
  const payload = new Uint8Array(25)
  payload[0] = IRIUM_P2PKH_VERSION
  payload.set(pkh, 1)
  const chk = sha256d(payload.subarray(0, 21))
  payload.set(chk.subarray(0, 4), 21)
  return base58(payload)
}

// ── coinbase parse ───────────────────────────────────────────────────────────
function fromHex(h: string): Uint8Array {
  const a = new Uint8Array(h.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16)
  return a
}

// Read 8 little-endian bytes as a JS number. Avoids BigInt (the app's esbuild
// target predates BigInt literals). Coinbase output values and script lengths
// are far below 2^53, so lo + hi*2^32 is exact.
function readU64le(b: Uint8Array, i: number): number {
  const lo = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
  const hi = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0
  return hi * 0x100000000 + lo
}

// Bitcoin varint reader → [value, nextIndex].
function readVarint(b: Uint8Array, i: number): [number, number] {
  const n = b[i]
  if (n < 0xfd) return [n, i + 1]
  if (n === 0xfd) return [b[i + 1] | (b[i + 2] << 8), i + 3]
  if (n === 0xfe) return [(b[i + 1] | (b[i + 2] << 8) | (b[i + 3] << 16) | (b[i + 4] << 24)) >>> 0, i + 5]
  return [readU64le(b, i + 1), i + 9]
}

function classify(spk: Uint8Array, value: number): { type: string; address: string | null } {
  if (
    spk.length === 25 &&
    spk[0] === 0x76 && spk[1] === 0xa9 && spk[2] === 0x14 &&
    spk[23] === 0x88 && spk[24] === 0xac
  ) {
    return { type: 'p2pkh', address: pkhToAddress(spk.subarray(3, 23)) }
  }
  if (spk.length > 0 && spk[0] === 0x6a) return { type: 'op_return', address: null }
  if (value === 0 && spk.length > 30) return { type: 'irium_data', address: null }
  return { type: 'unknown', address: null }
}

const ROLES: Array<[string, string]> = [
  ['Primary', '55%'],
  ['Compute', '22%'],
  ['Verify', '13%'],
  ['Support', '10%'],
]

/**
 * Decode a raw coinbase transaction hex (tx_hex[0] from /rpc/block) into
 * labelled reward-distribution rows. Returns [] if the hex is missing or
 * unparseable so callers can simply omit the section.
 *
 * The coinbase prev_hash on this chain is length-prefixed, so the input is
 * skipped by anchoring on the 0xffffffff prevout-index marker — identical to
 * the proven cbdecode.py — rather than a fixed-offset walk.
 */
export function decodeCoinbaseRewards(coinbaseHex: string): RewardRow[] {
  try {
    if (!coinbaseHex || coinbaseHex.length < 20) return []
    const b = fromHex(coinbaseHex)
    let idx = -1
    for (let k = 4; k + 4 <= b.length; k++) {
      if (b[k] === 0xff && b[k + 1] === 0xff && b[k + 2] === 0xff && b[k + 3] === 0xff) { idx = k; break }
    }
    if (idx < 0) return []
    let i = idx + 4
    let ssl: number
    ;[ssl, i] = readVarint(b, i) // scriptSig length
    i += ssl                     // scriptSig
    i += 4                       // sequence
    let outCount: number
    ;[outCount, i] = readVarint(b, i)
    const rows: RewardRow[] = []
    let p2pkhSeen = 0
    for (let n = 0; n < outCount; n++) {
      const value = readU64le(b, i)
      i += 8
      let sl: number
      ;[sl, i] = readVarint(b, i)
      const spk = b.subarray(i, i + sl)
      i += sl
      const c = classify(spk, value)
      let role: string
      let pct: string | null = null
      if (c.type === 'p2pkh') {
        if (p2pkhSeen < ROLES.length) {
          role = ROLES[p2pkhSeen][0]
          pct = ROLES[p2pkhSeen][1]
        } else {
          role = `Output ${n}`
        }
        p2pkhSeen++
      } else if (c.type === 'op_return') {
        role = 'Commitment (irx1)'
      } else if (c.type === 'irium_data') {
        role = 'Data'
      } else {
        role = `Output ${n}`
      }
      rows.push({ vout: n, role, pct, scriptType: c.type, address: c.address, valueSats: value })
    }
    return rows
  } catch {
    return []
  }
}
