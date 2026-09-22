/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        secondary: '#0F766E',
        accent: '#7C3AED',
        canvas: '#F8FAFC',
        surface: '#FFFFFF',
        line: '#E2E8F0',
        ink: '#0F172A',
        muted: '#64748B',
        success: '#16A34A',
        warning: '#F59E0B',
        danger: '#DC2626',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.04)',
      },
      fontFamily: {
        sans: ['Segoe UI', 'Arial', 'Noto Sans Hebrew', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
