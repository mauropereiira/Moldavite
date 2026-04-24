import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

const ANALYZE = process.env.ANALYZE === '1';

export default defineConfig({
  plugins: [
    react(),
    ANALYZE &&
      visualizer({
        filename: 'dist/bundle-stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        open: false,
      }),
  ].filter(Boolean),
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: ['es2022', 'chrome110', 'safari15'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'tiptap-vendor';
          if (
            id.includes('markdown-it') ||
            id.includes('turndown') ||
            id.includes('dompurify')
          )
            return 'markdown-vendor';
          if (id.includes('date-fns')) return 'date-vendor';
          if (id.includes('@dnd-kit')) return 'dnd-vendor';
          if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});
