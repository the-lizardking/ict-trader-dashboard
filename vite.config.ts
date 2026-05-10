import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      // Vendor-level code splitting. Each split bumps cache efficiency
      // (deps don't invalidate when app code changes) and drops the
      // entry chunk below Vite's 500 kB warning threshold. React.lazy
      // on the tab components (Dashboard.tsx) handles route-level
      // splitting; this handles dependency-level splitting.
      rollupOptions: {
        output: {
          manualChunks: {
            // Recharts pulls in d3-* + a non-trivial render layer.
            // Used by EquityChart (Overview) + PerformanceTab.
            recharts: ['recharts'],
            // Framer Motion is large and feature-complete; only used
            // for sidebar transitions + modal animations.
            motion: ['motion', 'motion/react'],
            // The Gemini SDK is the single largest non-React dependency
            // and is only used when the AI-analysis modal opens.
            'gemini-sdk': ['@google/genai'],
            // Lucide tree-shakes well, but a pinned chunk improves
            // caching across deploys.
            'lucide-icons': ['lucide-react'],
          },
        },
      },
    },
  };
});
