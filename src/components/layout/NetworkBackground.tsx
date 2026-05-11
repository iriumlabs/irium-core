import { useEffect, useRef } from 'react';

// Continuously-animating mesh-gradient background. Several large soft-edged
// "blobs" of brand colour drift, scale, and morph across the canvas at all
// times. A sparse high-velocity particle layer sits on top to read as crypto
// transaction packets travelling across the network. Sits behind app chrome
// via z-index 0 + pointer-events:none, and never overlaps content because
// cards/panels in the app are opaque (so blobs only show in atmospheric
// space — page padding, gaps between cards). Honors prefers-reduced-motion.

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseR: number;
  hue: 'cyan' | 'purple' | 'blue' | 'iris';
  phase: number;       // for radius pulsation
  phaseRate: number;
};

type Packet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;        // 0..1, rises over lifetime
  ttl: number;         // total ms life
  age: number;         // ms elapsed
  hue: 'cyan' | 'purple';
};

const HUES = {
  cyan:   '110,198,255',     // brand
  iris:   '167,139,250',     // brand-secondary purple
  purple: '139,92,246',      // deeper purple
  blue:   '59,59,255',       // saturated cobalt (logo's blue)
} as const;

const BLOB_COUNT          = 8;
const BLOB_MIN_R          = 240;   // px
const BLOB_MAX_R          = 480;   // px
const BLOB_DRIFT          = 0.95;  // px/frame max — visible drift
const PACKET_SPAWN_INTRVL = 380;   // ms avg between packet bursts
const PACKET_TTL          = 2600;  // ms

export default function NetworkBackground() {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const lastPacketAt = useRef<number>(0);
  const lastFrameAt  = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width  = canvas.clientWidth;
    let height = canvas.clientHeight;

    const resize = () => {
      dpr    = Math.min(window.devicePixelRatio || 1, 2);
      width  = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width  = width  * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Initial blob layout — distribute roughly across the canvas
    const hueOrder: Blob['hue'][] = ['cyan', 'iris', 'blue', 'cyan', 'purple', 'iris', 'blue'];
    const blobs: Blob[] = Array.from({ length: BLOB_COUNT }).map((_, i) => {
      const baseR = BLOB_MIN_R + Math.random() * (BLOB_MAX_R - BLOB_MIN_R);
      // Give every blob a guaranteed minimum speed so none look stalled.
      const angle = Math.random() * Math.PI * 2;
      const speed = BLOB_DRIFT * (0.55 + Math.random() * 0.45);
      return {
        x:  Math.random() * width,
        y:  Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r:  baseR,
        baseR,
        hue: hueOrder[i % hueOrder.length],
        phase: Math.random() * Math.PI * 2,
        phaseRate: 0.0028 + Math.random() * 0.0024,   // ~3x faster breath
      };
    });

    const packets: Packet[] = [];

    const tick = (now: number) => {
      const dt = lastFrameAt.current ? now - lastFrameAt.current : 16;
      lastFrameAt.current = now;

      ctx.clearRect(0, 0, width, height);

      // Each blob is drawn as a large radial gradient. Blending these in
      // 'lighter' composite mode adds their colour additively, which gives
      // the soft "morphing aurora" effect.
      ctx.globalCompositeOperation = 'lighter';

      for (const b of blobs) {
        if (!reduceMotion) {
          b.x += b.vx;
          b.y += b.vy;
          b.phase += b.phaseRate * dt;
          // Soft bounce — keep blobs roaming the canvas
          if (b.x < -b.r * 0.4 || b.x > width  + b.r * 0.4) b.vx *= -1;
          if (b.y < -b.r * 0.4 || b.y > height + b.r * 0.4) b.vy *= -1;
          // Continuously breathe radius
          b.r = b.baseR * (0.85 + 0.18 * Math.sin(b.phase));
        }

        const c = HUES[b.hue];
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        grad.addColorStop(0,    `rgba(${c},0.42)`);
        grad.addColorStop(0.4,  `rgba(${c},0.16)`);
        grad.addColorStop(0.75, `rgba(${c},0.04)`);
        grad.addColorStop(1,    `rgba(${c},0.00)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Reset to default for the packet layer (so packets read on top)
      ctx.globalCompositeOperation = 'source-over';

      // Spawn new packet streaks occasionally — represent transactions
      if (!reduceMotion && now - lastPacketAt.current > PACKET_SPAWN_INTRVL * (0.6 + Math.random() * 0.8)) {
        const burst = 1 + Math.floor(Math.random() * 2);
        for (let k = 0; k < burst; k++) {
          // Spawn at one edge, fly across at an angle
          const edge = Math.floor(Math.random() * 4);
          let x = 0, y = 0;
          let vx = 0, vy = 0;
          const speed = 0.85 + Math.random() * 0.55;
          if (edge === 0)      { x = -10;       y = Math.random() * height; vx =  speed; vy = (Math.random() - 0.5) * 0.4; }
          else if (edge === 1) { x = width+10;  y = Math.random() * height; vx = -speed; vy = (Math.random() - 0.5) * 0.4; }
          else if (edge === 2) { x = Math.random() * width; y = -10;        vx = (Math.random() - 0.5) * 0.4; vy =  speed; }
          else                 { x = Math.random() * width; y = height+10;  vx = (Math.random() - 0.5) * 0.4; vy = -speed; }
          packets.push({
            x, y, vx, vy,
            life: 0,
            ttl:  PACKET_TTL,
            age:  0,
            hue:  Math.random() < 0.55 ? 'cyan' : 'purple',
          });
        }
        lastPacketAt.current = now;
      }

      // Advance + draw packets (with a fading trail for cinema)
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        if (!reduceMotion) {
          p.x += p.vx * dt * 0.22;          // ~3.5x faster — clearly readable motion
          p.y += p.vy * dt * 0.22;
          p.age += dt;
          p.life = p.age / p.ttl;
        }
        if (p.age >= p.ttl ||
            p.x < -50 || p.x > width  + 50 ||
            p.y < -50 || p.y > height + 50) {
          packets.splice(i, 1);
          continue;
        }
        const fade = Math.sin(Math.PI * p.life);   // 0 → 1 → 0 over lifetime
        const c = p.hue === 'cyan' ? HUES.cyan : HUES.iris;
        // Trail length proportional to current speed so faster packets look it
        const tlen = 56;
        const tx = p.x - p.vx * tlen;
        const ty = p.y - p.vy * tlen;
        const tg = ctx.createLinearGradient(p.x, p.y, tx, ty);
        tg.addColorStop(0, `rgba(${c},${0.85 * fade})`);
        tg.addColorStop(1, `rgba(${c},0.00)`);
        ctx.strokeStyle = tg;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        // Head halo
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 11);
        halo.addColorStop(0,    `rgba(${c},${0.85 * fade})`);
        halo.addColorStop(0.45, `rgba(${c},${0.25 * fade})`);
        halo.addColorStop(1,    `rgba(${c},0.00)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        ctx.fill();
        // Head core
        ctx.fillStyle = `rgba(${c},${0.95 * fade})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.95 }}
    />
  );
}
