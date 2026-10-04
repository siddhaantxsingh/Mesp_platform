import type { Config } from 'tailwindcss'

const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: c('background'), foreground: c('foreground'), surface: c('surface'), 'surface-2': c('surface-2'),
        muted: c('muted'), border: c('border'), ring: c('ring'),
        primary: { DEFAULT: c('primary'), foreground: c('primary-foreground') },
        critical: c('critical'), warning: c('warning'), info: c('info'), ok: c('ok'),
        ecg: c('signal-ecg'), 'ppg-red': c('signal-ppg-red'), 'ppg-ir': c('signal-ppg-ir'),
        'imu-x': c('signal-imu-x'), 'imu-y': c('signal-imu-y'), 'imu-z': c('signal-imu-z'), 'imu-mag': c('signal-imu-mag'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 4px)', sm: 'calc(var(--radius) - 8px)' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'none' } },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.35' } },
      },
      animation: { 'fade-up': 'fade-up .5s cubic-bezier(.22,1,.36,1) both', pulse2: 'pulse2 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
} satisfies Config
