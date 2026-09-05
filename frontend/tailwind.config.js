/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'rgb(var(--omni-brand-50, 236 253 245) / <alpha-value>)',
          100: 'rgb(var(--omni-brand-100, 209 250 229) / <alpha-value>)',
          200: 'rgb(var(--omni-brand-200, 167 243 208) / <alpha-value>)',
          300: 'rgb(var(--omni-brand-300, 110 231 183) / <alpha-value>)',
          400: 'rgb(var(--omni-brand-400, 52 211 153) / <alpha-value>)',
          500: 'rgb(var(--omni-brand-500, 16 185 129) / <alpha-value>)',
          600: 'rgb(var(--omni-brand-600, 5 150 105) / <alpha-value>)',
          700: 'rgb(var(--omni-brand-700, 4 120 87) / <alpha-value>)',
          800: 'rgb(var(--omni-brand-800, 6 95 70) / <alpha-value>)',
          900: 'rgb(var(--omni-brand-900, 6 78 59) / <alpha-value>)',
          950: 'rgb(var(--omni-brand-950, 2 44 34) / <alpha-value>)',
        },
        accent: {
          50: 'rgb(var(--omni-accent-50, 239 246 255) / <alpha-value>)',
          100: 'rgb(var(--omni-accent-100, 219 234 254) / <alpha-value>)',
          200: 'rgb(var(--omni-accent-200, 191 219 254) / <alpha-value>)',
          300: 'rgb(var(--omni-accent-300, 147 197 253) / <alpha-value>)',
          400: 'rgb(var(--omni-accent-400, 96 165 250) / <alpha-value>)',
          500: 'rgb(var(--omni-accent-500, 59 130 246) / <alpha-value>)',
          600: 'rgb(var(--omni-accent-600, 37 99 235) / <alpha-value>)',
          700: 'rgb(var(--omni-accent-700, 29 78 216) / <alpha-value>)',
          800: 'rgb(var(--omni-accent-800, 30 64 175) / <alpha-value>)',
          900: 'rgb(var(--omni-accent-900, 30 58 138) / <alpha-value>)',
          950: 'rgb(var(--omni-accent-950, 23 37 84) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
      },
    },
  },
  plugins: [],
};
