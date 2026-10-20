import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Exact policy; see spec "Content-Security-Policy and no-network rule".
// Never widen this ad hoc: update the spec first.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

// Build only: the dev server injects an inline React-refresh <script> that this policy would block.
function cspMeta(): Plugin {
  return {
    name: 'tbp-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

// Dev/preview servers are bound to loopback only. Never pass `--host`.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cspMeta()],
  server: { host: '127.0.0.1', fs: { strict: true } },
  preview: { host: '127.0.0.1' },
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // Separate vendor chunks so app updates do not invalidate the cached three.js/React code.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/ },
          ],
        },
      },
    },
    // three.js alone is ~550 kB minified (~140 kB gzip) and cannot be split further; the app
    // is a single-view tool that needs it on first paint, so lazy loading would not help.
    chunkSizeWarningLimit: 700,
  },
});
