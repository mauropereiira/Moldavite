/**
 * Resolves once the main thread has kept time for a few consecutive seconds
 * while the window is visible. A plugin that crashes or floods the webview
 * keeps it pending, which leaves the startup marker for the next launch to
 * find. Hidden time does not count: WebKit throttles timers in a hidden or
 * occluded window, and that must not read as a hang.
 */

interface SettleOptions {
  steadyTicks?: number;
  intervalMs?: number;
  maxLagMs?: number;
  now?: () => number;
  isVisible?: () => boolean;
}

export function whenMainThreadSettles({
  steadyTicks = 5,
  intervalMs = 1_000,
  maxLagMs = 500,
  now = () => window.performance.now(),
  isVisible = () => document.visibilityState === 'visible',
}: SettleOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    let steady = 0;
    let expected = now() + intervalMs;
    const tick = () => {
      const at = now();
      steady = at - expected <= maxLagMs && isVisible() ? steady + 1 : 0;
      if (steady >= steadyTicks) {
        resolve();
        return;
      }
      expected = at + intervalMs;
      setTimeout(tick, intervalMs);
    };
    setTimeout(tick, intervalMs);
  });
}
