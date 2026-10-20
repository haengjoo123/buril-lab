import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Isolated UI fixture: never read production credentials or install a service worker.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir: 'node_modules/.vite-adaptive',
  build: { outDir: 'output/playwright/adaptive/site', rollupOptions: { input: 'e2e/adaptive/fixture.html' }, chunkSizeWarningLimit: 2500 },
  envDir: false,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('adaptive-fixture-public-key'),
    'import.meta.env.VITE_ENABLE_CHEMICAL_ENRICHMENT': JSON.stringify('false'),
    'import.meta.env.VITE_ENABLE_SEARCH_ANALYTICS': JSON.stringify('false'),
    'import.meta.env.VITE_ENABLE_WASTE_V2': JSON.stringify('true'),
  },
});
