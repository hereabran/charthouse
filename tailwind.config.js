/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        gv: {
          bg: 'var(--gv-bg)',
          bg2: 'var(--gv-bg2)',
          bg3: 'var(--gv-bg3)',
          fg: 'var(--gv-fg)',
          fg2: 'var(--gv-fg2)',
          dim: 'var(--gv-dim)',
          border: 'var(--gv-border)',
          red: 'var(--gv-red)',
          green: 'var(--gv-green)',
          yellow: 'var(--gv-yellow)',
          blue: 'var(--gv-blue)',
          purple: 'var(--gv-purple)',
          aqua: 'var(--gv-aqua)',
          orange: 'var(--gv-orange)',
          accent: 'var(--gv-accent)',
        },
      },
    },
  },
  plugins: [],
}
