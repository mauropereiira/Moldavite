import { defineConfig } from 'vitest/config';

// Standalone from the app's vitest config on purpose: this package builds a
// browser extension, not the Tauri frontend, and shares none of its setup.
export default defineConfig({
  // An inline PostCSS config stops Vite walking up to the app's
  // postcss.config.js, which pulls in a Tailwind plugin this package does not
  // install. It only bites in CI, where the root node_modules is not there.
  css: { postcss: {} },
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.test.js'],
    environment: 'jsdom',
  },
});
