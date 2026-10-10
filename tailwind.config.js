/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)',
        surface: 'var(--card)',
        band: 'var(--band)',
        hd: 'var(--hd)',
        hdt: 'var(--hdt)',
        ink: 'var(--tx)',
        muted: 'var(--mu)',
        primary: 'var(--ac)',
        onAccent: 'var(--on)',
        line: 'var(--bd)',
        highlight: 'var(--band)',
        highlightLine: 'var(--band-line)',
        primaryDark: 'var(--ac-dark)',
        secondary: 'var(--secondary)',
        secondaryDark: 'var(--secondary-dark)',
        danger: 'var(--danger)',
        dangerDark: 'var(--danger-dark)',
        dangerSoft: 'var(--danger-soft)',
        success: 'var(--success)',
        successSoft: 'var(--success-soft)',
        warning: 'var(--warning)',
        warningSoft: 'var(--warning-soft)',
        overlay: 'var(--overlay)',
        knob: 'var(--knob)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
      fontFamily: {
        sans: ['var(--font-body, Segoe UI)', 'Arial', 'Noto Sans Hebrew', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
