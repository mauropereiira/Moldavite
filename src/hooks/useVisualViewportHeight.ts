import { useLayoutEffect } from 'react';
import { isMobilePlatform } from '@/lib/platform';

/**
 * Keeps `--app-height` on `<html>` equal to the visual viewport's height.
 *
 * iOS never shrinks the layout viewport for the software keyboard, so a shell
 * sized with `100vh` keeps its bottom — the editor footer, the last lines of
 * a note — underneath the keys. `window.visualViewport` does shrink, and its
 * `scroll` event covers the keyboard pushing the page up. The mobile shell
 * reads the property as `height: var(--app-height)`; desktop keeps `h-screen`
 * and never sets it.
 */
export function useVisualViewportHeight(): void {
  useLayoutEffect(() => {
    if (!isMobilePlatform()) return;

    const root = document.documentElement;
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty('--app-height', `${Math.round(height)}px`);
      // WKWebView also scrolls the whole page to keep the caret clear of the
      // keyboard, which drags the shell under the status bar. The shell has
      // already shrunk to the visual viewport, so the editor's own scroll
      // container is what should move; put the page back.
      if (window.scrollY > 0 || (viewport?.offsetTop ?? 0) > 0) window.scrollTo(0, 0);
    };
    update();

    if (viewport) {
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
    } else {
      window.addEventListener('resize', update);
    }
    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
      } else {
        window.removeEventListener('resize', update);
      }
      root.style.removeProperty('--app-height');
    };
  }, []);
}
