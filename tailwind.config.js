/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        irium: {
          50:  '#f0eaff',
          100: '#ddd0ff',
          200: '#c3a8ff',
          300: '#a97eff',
          400: '#9155ff',
          500: '#7b2fe2',
          600: '#6a21cc',
          700: '#5715b0',
          800: '#460d90',
          900: '#330872',
          950: '#1a0040',
        },
        blue: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        surface: {
          base: '#080810',
          900:  '#080810',
          800:  '#0d0d1a',
          700:  '#121226',
          600:  '#18182f',
          500:  '#1e1e3a',
          400:  '#252548',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body:    ['"DM Sans"',       'sans-serif'],
        mono:    ['"Geist Mono"',    'monospace'],
      },
      backgroundImage: {
        'gradient-irium':        'linear-gradient(135deg, #7b2fe2 0%, #2563eb 100%)',
        'gradient-irium-subtle': 'linear-gradient(135deg, rgba(123,47,226,0.15) 0%, rgba(37,99,235,0.15) 100%)',
        'gradient-card':         'linear-gradient(145deg, rgba(30,30,58,0.8) 0%, rgba(13,13,26,0.9) 100%)',
        'mesh-gradient': [
          'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(123,47,226,0.15) 0%, transparent 60%)',
          'radial-gradient(ellipse 60% 80% at 80% 70%, rgba(59,130,246,0.10) 0%, transparent 60%)',
        ].join(', '),
      },
      boxShadow: {
        'irium-glow':    '0 0 30px rgba(123,47,226,0.3), 0 0 60px rgba(37,99,235,0.15)',
        'irium-glow-sm': '0 0 15px rgba(123,47,226,0.2)',
        'card':          '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        'glow-purple':   '0 0 20px rgba(123,47,226,0.45)',
        'glow-blue':     '0 0 20px rgba(59,130,246,0.40)',
        'glow-green':    '0 0 20px rgba(34,197,94,0.45)',
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
