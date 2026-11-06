import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const fromRoot = (path: string) => normalizePath(fileURLToPath(new URL(`../../${path}`, import.meta.url)));
/** Windows paths may differ in letter case between the resolver and URL conversion. */
const pathKey = (path: string) => normalizePath(path).toLowerCase();

/**
 * Operator services are plain ES module exports, which the fixture cannot reassign the way it
 * does `inventoryService.getItems`. Every importer gets a fixture copy instead: the real module,
 * with its list/summary call answered by e2e/adaptive/serviceStubs.ts (filled in by fixture.tsx).
 */
const SERVICE_STUBS = new Map([
  ['src/services/opsAdminService.ts', 'e2e/adaptive/stubs/opsAdminService.ts'],
  ['src/services/feedbackAdminService.ts', 'e2e/adaptive/stubs/feedbackAdminService.ts'],
  ['src/services/opsAnalyticsService.ts', 'e2e/adaptive/stubs/opsAnalyticsService.ts'],
].map(([real, stub]) => [pathKey(fromRoot(real)), fromRoot(stub)]));
const STUB_FILES = new Set([...SERVICE_STUBS.values()].map(pathKey));
const STUBBED_SPECIFIER = /(?:^|\/)(?:opsAdminService|feedbackAdminService|opsAnalyticsService)(?:\.ts)?$/;

function fixtureServiceStubs(): Plugin {
  return {
    name: 'adaptive-fixture-service-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // The stubs themselves import the real module.
      if (!importer || !STUBBED_SPECIFIER.test(source) || STUB_FILES.has(pathKey(importer))) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      return SERVICE_STUBS.get(pathKey(resolved.id)) ?? resolved;
    },
  };
}

// Isolated UI fixture: never read production credentials or install a service worker.
export default defineConfig({
  plugins: [fixtureServiceStubs(), react(), tailwindcss()],
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
