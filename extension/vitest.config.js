import { defineConfig } from 'vitest/config';

// Standalone from the app's vitest config on purpose: this package builds a
// browser extension, not the Tauri frontend, and shares none of its setup.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.test.js'],
    environment: 'jsdom',
  },
});
