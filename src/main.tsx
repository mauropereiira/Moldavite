import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (no third-party CDN — local-first privacy)
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';
import App from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { isMobilePlatform } from './lib/platform';
import './index.css';
import './mobile.css';

// Stamped before the first render so the very first paint is already the
// phone layout on a phone; see src/lib/platform.ts and src/mobile.css.
document.documentElement.dataset.platform = isMobilePlatform() ? 'mobile' : 'desktop';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element "#root" not found in index.html');
}
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
