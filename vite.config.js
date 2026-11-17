import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/ULTRON2.5/',
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
