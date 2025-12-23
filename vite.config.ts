import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === 'true' ? '/pc-technician-booking/' : '/',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
