import { useEffect, useRef } from 'react';
import { useStore } from '../../lib/store';
import type { Theme } from '../../lib/types';

// Cinematic background — premium / restrained.
//
// Composition (back → front):
//   1. Aurora blobs       — 4 huge soft radial gradients drifting laterally
//                            with edge bounce + slow breathing. Painted with
//                            'lighter' blend so overlaps glow softly.
//   2. Pinpoint stars     — 14 tiny precise dots, no halos, slow horizontal
//                            drift. Adds sharp detail to break up the wash.
//   3. Film grain overlay — fixed SVG fractal-noise pattern at ~4 % alpha
//                            with `mix-blend-mode: overlay`. Gives an analog
//                            texture that signals "produced" rather than
//                            "shader-generated".
//
// What we deliberately do NOT have (and why):
//   • Connecting filaments / mesh lines  → reads as engineering / demo
//   • Pulsing halos around particles     → reads as arcade
//   • Random-walk drift                  → reads as chaotic
//   • Saturated colors                   → reads as vibe-board, not product
//
// Sits behind app chrome via z-index 0 + pointer-events:none. The radial
// alpha mask hides the animation behind the main content area so the canvas
// is only visible in the page gutters. Honors prefers-reduced-motion.

type Aurora = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseR: number;
  phase: number;
  phaseRate: number;
  hueIdx: number;      // index into the active palette's aurora list
};

type Star = {
  x: number;
  y: number;
  vx: number;
  size: number;
  alpha: number;
  hueIdx: number;
};

// Per-theme palettes as `r,g,b` triples (string form so they slot directly
// into `rgba(...)`). Each palette is ordered [aurora..., star...] — aurora
// blobs cycle through positions 0..3; stars cycle through 0..2 of `stars`.
const PALETTES: Record<Theme, { auroras: string[]; stars: string[] }> = {
  midnight: {
    auroras: ['110,198,255', '167,139,250', '99,102,241', '110,198,255'],
    stars:   ['230,235,250', '110,198,255', '167,139,250'],
  },
  obsidian: {
    auroras: ['200,208,219', '143,151,163', '255,255,255', '200,208,219'],
    stars:   ['255,255,255', '200,208,219', '143,151,163'],
  },
  aurora: {
    auroras: ['16,185,129', '94,234,212', '4,120,87', '16,185,129'],
    stars:   ['236,253,245', '94,234,212', '16,185,129'],
  },
  nebula: {
    auroras: ['192,132,252', '240,171,252', '126,34,206', '192,132,252'],
    stars:   ['250,232,255', '240,171,252', '192,132,252'],
  },
};

const AURORA_COUNT  = 5;
const AURORA_MIN_R  = 420;
const AURORA_MAX_R  = 780;
const AURORA_DRIFT  = 0.05;     // px/frame max — barely-there motion
const STAR_COUNT    = 20;
const STAR_DRIFT    = 0.035;    // px/frame max

// Inline SVG fractal-noise tile. Embedded as a background-image so the
// browser caches the rasterized result. ~200×200 tile, repeated.
const GRAIN_SVG_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>" +
    "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter>" +
    "<rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

export default function NetworkBackground() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rafRef      = useRef<number>(0);
  const lastFrameAt = useRef<number>(0);
  // Pulled here so a theme switch (forced via key={theme} on the parent)
  // re-runs the useEffect with the new palette.
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let dpr    = Math.min(window.devicePixelRatio || 1, 2);
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

    // Resolve the active palette once at mount time. Theme switches force
    // a remount via key={theme} so this naturally re-runs.
    const palette = PALETTES[theme] ?? PALETTES.midnight;

    // ── Aurora seeds: spread across the canvas, lateral-biased drift,
    // each blob carries its own slow radius-breathing phase so they never
    // pulse in sync.
    const auroras: Aurora[] = Array.from({ length: AURORA_COUNT }).map((_, i) => {
      const baseR = AURORA_MIN_R + Math.random() * (AURORA_MAX_R - AURORA_MIN_R);
      const dir   = Math.random() < 0.5 ? -1 : 1;
      return {
        x:  Math.random() * width,
        y:  Math.random() * height,
        vx: dir * AURORA_DRIFT * (0.55 + Math.random() * 0.45),
        vy: (Math.random() - 0.5) * AURORA_DRIFT * 0.4,
        baseR,
        phase:     Math.random() * Math.PI * 2,
        phaseRate: 0.0006 + Math.random() * 0.0006,   // ~10 s cycle
        hueIdx: i % palette.auroras.length,
      };
    });

    // ── Stars: small precise pinpoints, lateral drift only.
    const stars: Star[] = Array.from({ length: STAR_COUNT }).map((_, i) => {
      const dir = Math.random() < 0.5 ? -1 : 1;
      return {
        x:      Math.random() * width,
        y:      Math.random() * height,
        vx:     dir * STAR_DRIFT * (0.5 + Math.random() * 0.7),
        size:   0.7 + Math.random() * 1.1,                // 0.7..1.8 px
        alpha:  0.40 + Math.random() * 0.45,              // 0.40..0.85
        hueIdx: i % palette.stars.length,
      };
    });

    const tick = (now: number) => {
      const dt = lastFrameAt.current ? now - lastFrameAt.current : 16;
      lastFrameAt.current = now;

      ctx.clearRect(0, 0, width, height);

      // ── Pass 1: aurora ────────────────────────────────────────────
      // 'lighter' = additive blend → overlaps brighten softly rather than
      // washing each other out.
      ctx.globalCompositeOperation = 'lighter';
      for (const a of auroras) {
        if (!reduceMotion) {
          a.x += a.vx;
          a.y += a.vy;
          a.phase += a.phaseRate * dt;
          // Edge bounce keeps blobs roaming in-frame; the wide drift
          // margin (0.4 r) means they slide off and back like a slow tide.
          if (a.x < -a.baseR * 0.4 || a.x > width  + a.baseR * 0.4) a.vx *= -1;
          if (a.y < -a.baseR * 0.4 || a.y > height + a.baseR * 0.4) a.vy *= -1;
        }
        const r    = a.baseR * (0.88 + 0.18 * Math.sin(a.phase));
        const c    = palette.auroras[a.hueIdx];
        const grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
        // Brighter aurora — visible color life, still well below saturation.
        grad.addColorStop(0,    `rgba(${c},0.24)`);
        grad.addColorStop(0.45, `rgba(${c},0.09)`);
        grad.addColorStop(1,    `rgba(${c},0.00)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // ── Pass 2: pinpoint stars ────────────────────────────────────
      // No halo — premium dots are sharp. The aurora behind them
      // provides the atmospheric glow; bare cores keep the detail crisp.
      for (const s of stars) {
        if (!reduceMotion) {
          s.x += s.vx;
          if (s.x < -10)            s.x = width + 10;
          else if (s.x > width + 10) s.x = -10;
        }
        ctx.fillStyle = `rgba(${palette.stars[s.hueIdx]},${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [theme]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          opacity: 0.95,
          // Radial alpha mask — hides the animation behind the main content
          // area; reveals it in the gutters around sidebar/topbar/statusbar.
          maskImage:
            'radial-gradient(ellipse 70% 90% at 60% 50%, transparent 12%, rgba(0,0,0,0.55) 48%, black 88%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 90% at 60% 50%, transparent 12%, rgba(0,0,0,0.55) 48%, black 88%)',
        }}
      />
      {/* Film grain overlay — analog texture that signals "produced" rather
          than "synthetic". Static (no animation needed) because the eye
          reads the noise pattern as constant texture, not motion. Masked
          identically to the canvas so it only appears where the canvas
          appears. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: GRAIN_SVG_URL,
          backgroundSize:  '200px 200px',
          opacity:         0.045,
          mixBlendMode:    'overlay',
          maskImage:
            'radial-gradient(ellipse 70% 90% at 60% 50%, transparent 12%, rgba(0,0,0,0.55) 48%, black 88%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 90% at 60% 50%, transparent 12%, rgba(0,0,0,0.55) 48%, black 88%)',
        }}
      />
    </>
  );
}
