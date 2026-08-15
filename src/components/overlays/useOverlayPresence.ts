import { useEffect, useState } from 'react';

const EXIT_DURATION_MS = 200;

/** Keeps an overlay mounted long enough for its exit animation to finish. */
export function useOverlayPresence(isOpen: boolean) {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setIsRendered(true);
        setIsClosing(false);
      });
      return () => {
        cancelled = true;
      };
    }

    if (!isRendered) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timeout = 0;
    const frame = window.requestAnimationFrame(() => {
      setIsClosing(true);
      timeout = window.setTimeout(
        () => {
          setIsClosing(false);
          setIsRendered(false);
        },
        reduceMotion ? 0 : EXIT_DURATION_MS
      );
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [isOpen, isRendered]);

  // Opening must not depend on requestAnimationFrame. Webviews and background
  // browser tabs may throttle the first frame, which previously left the
  // overlay absent even though its store state was already open. The retained
  // state is only needed for the closing animation.
  return { isRendered: isOpen || isRendered, isClosing: !isOpen && isClosing };
}
