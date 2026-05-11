/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette — cyan-blue, derived from the Block Explorer reference
        // and harmonised with the Irium logo's blue half. Repointed from the
        // legacy purple so any `text-irium-400` / `bg-irium-500/15` etc. that
        // used to mean "brand" picks up the new brand automatically.
        irium: {
          50:  '#e6f4ff',
          100: '#cce8ff',
          200: '#a0d6ff',
          300: '#7cc6ff',
          400: '#6ec6ff',
          500: '#3aabe6',
          600: '#2a8cc7',
          700: '#1f6fa3',
          800: '#1a567f',
          900: '#143f5d',
          950: '#0a2238',
        },
        // Secondary accent (logo's purple half). Use `text-iris-300` / `bg-iris-500/15`
        // when you want the violet highlight specifically.
        iris: {
          50:  '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        blue: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        surface: {
          base: '#02050E',
          900:  '#02050E',
          800:  '#070A18',
          700:  '#0C1124',
          600:  '#121833',
          500:  '#1A2244',
          400:  '#222B57',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"',   'sans-serif'],
        body:    ['"Inter"',           'sans-serif'],
        mono:    ['"JetBrains Mono"',  'monospace'],
      },
      backgroundImage: {
        // Brand gradient = logo's blue→purple (used on primary CTAs and hero panels)
        'grad-brand':         'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
        'grad-brand-soft':    'linear-gradient(135deg, rgba(59,59,255,0.18) 0%, rgba(110,198,255,0.12) 50%, rgba(167,139,250,0.18) 100%)',
        'grad-text':          'linear-gradient(90deg, #d4eeff 0%, #6ec6ff 55%, #a78bfa 100%)',
        'gradient-irium':     'linear-gradient(135deg, #3b3bff 0%, #6ec6ff 50%, #a78bfa 100%)',
        'gradient-irium-subtle': 'linear-gradient(135deg, rgba(59,59,255,0.15) 0%, rgba(167,139,250,0.15) 100%)',
        'gradient-card':      'linear-gradient(145deg, rgba(8,11,20,0.85) 0%, rgba(2,5,14,0.95) 100%)',
        'mesh-gradient': [
          'radial-gradient(ellipse 80% 60% at 12% 18%, rgba(59,59,255,0.08) 0%, transparent 60%)',
          'radial-gradient(ellipse 60% 80% at 88% 78%, rgba(167,139,250,0.06) 0%, transparent 60%)',
          'radial-gradient(ellipse 40% 40% at 60% 40%, rgba(110,198,255,0.04) 0%, transparent 50%)',
        ].join(', '),
      },
      boxShadow: {
        'irium-glow':    '0 0 28px rgba(110,198,255,0.30), 0 0 56px rgba(167,139,250,0.16)',
        'irium-glow-sm': '0 0 14px rgba(110,198,255,0.22)',
        'card':          '0 4px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
        'glow-cyan':     '0 0 20px rgba(110,198,255,0.45)',
        'glow-purple':   '0 0 20px rgba(167,139,250,0.40)',
        'glow-blue':     '0 0 20px rgba(59,130,246,0.40)',
        'glow-green':    '0 0 20px rgba(52,211,153,0.45)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      blur: {
        glass:       '12px',
        'glass-heavy': '24px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float':      'float 6s ease-in-out infinite',
        'shimmer':    'shimmer-slide 1.5s linear infinite',
        'spin-slow':  'spin 8s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)'  },
          '50%':      { transform: 'translateY(-6px)' },
        },
        'shimmer-slide': {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition:  '400px 0' },
        },
      },
    },
  },
  plugins: [],
};
