import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

const HOLD_MS = 450;
const SLOP_PX = 8;

/**
 * Press-and-hold with a finger opens what a right-click opens. WebKit on iOS
 * fires no `contextmenu` for a long press, so the row's menu was reachable
 * only through its Options button.
 *
 * `onLongPress` receives a stand-in for the contextmenu event, carrying the
 * press point. The click that follows the lift is swallowed, so the row does
 * not also open and the menu's own outside-click dismissal does not close it.
 */
export function useLongPress(onLongPress: (event: MouseEvent) => void) {
  const timer = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => cancel, []);

  return {
    onPointerDown: (event: PointerEvent) => {
      fired.current = false;
      if (event.pointerType !== 'touch') return;
      const { clientX, clientY } = event;
      start.current = { x: clientX, y: clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress({
          clientX,
          clientY,
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
        } as unknown as MouseEvent);
      }, HOLD_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (timer.current === null) return;
      const moved = Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y);
      if (moved > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
