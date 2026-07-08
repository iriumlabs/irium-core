import { useState } from 'react';
import { poolRewards } from '../lib/tauri';

// Minimal, UNSTYLED functional stub for PoAW-X pool delegation (Steps C/D/E).
// Visual polish is deferred until a display + a live pool are available for interactive
// testing; this exists so the whole flow can be smoke-tested the moment they are. Each
// control is wired directly to the real, tested backend commands (enable_direct_pool_rewards,
// get_delegation_status, generate_delegation_revocation).
export default function PoawxDelegationStub() {
  const [address, setAddress] = useState('');
  const [poolUrl, setPoolUrl] = useState('');
  const [worker, setWorker] = useState('default');
  const [expiry, setExpiry] = useState('10000000');
  const [nonce, setNonce] = useState('');
  const [networkId, setNetworkId] = useState('2');
  const [out, setOut] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setOut('working...');
    try {
      const r = await fn();
      setOut(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
    } catch (e) {
      setOut('ERROR: ' + String(e));
    }
  };

  return (
    <div style={{ border: '1px dashed #888', padding: 12, margin: 12, fontSize: 13 }}>
      <h3>PoAW-X pool delegation (stub — unstyled)</h3>
      <p style={{ color: '#a00' }}>
        Wired to real backend commands. Visual polish + live-pool testing deferred.
      </p>
      <div>
        <input
          placeholder="wallet address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <input
          placeholder="pool delegation URL (http://...)"
          value={poolUrl}
          onChange={(e) => setPoolUrl(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <input placeholder="worker" value={worker} onChange={(e) => setWorker(e.target.value)} />
        <input placeholder="expiry height" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </div>
      <button onClick={() => run(() => poolRewards.enableDirect(address, poolUrl, worker, Number(expiry)))}>
        Enable direct pool rewards (C)
      </button>{' '}
      <button onClick={() => run(() => poolRewards.status(address, poolUrl))}>
        Check delegation status (D)
      </button>
      <hr />
      <div>
        <input
          placeholder="deleg_nonce (from signup / status)"
          value={nonce}
          onChange={(e) => setNonce(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      <div>
        <input placeholder="network id" value={networkId} onChange={(e) => setNetworkId(e.target.value)} />
      </div>
      <button onClick={() => run(() => poolRewards.generateRevocation(address, nonce, Number(networkId)))}>
        Generate revocation — hand off (E)
      </button>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#111', color: '#0f0', padding: 8 }}>
        {out}
      </pre>
    </div>
  );
}
