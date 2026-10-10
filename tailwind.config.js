/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#735740',
        primaryDark: '#5A4332',
        secondary: '#8A7B68',
        secondaryDark: '#6E6151',
        accent: '#A67C52',
        canvas: '#D9CFC0',
        surface: '#E5DACA',
        line: '#C4B5A3',
        highlight: '#D4C4AE',
        highlightLine: '#BFAE98',
        ink: '#292524',
        muted: '#6B6259',
        success: '#16A34A',
        warning: '#F59E0B',
        danger: '#DC2626',
      },
      boxShadow: {
        card: '0 1px 2px rgba(41, 37, 36, 0.06), 0 8px 24px rgba(41, 37, 36, 0.04)',
      },
      fontFamily: {
        sans: ['Segoe UI', 'Arial', 'Noto Sans Hebrew', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
