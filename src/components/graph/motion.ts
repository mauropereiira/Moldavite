/** Easing and view tweens for the graph canvas. Pure, so tests can drive them with a fake clock. */

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export interface ViewTween {
  from: View;
  to: View;
  /** Timestamp of the first frame that applied it. */
  start: number | null;
  duration: number;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Move `current` toward `target`, closing about 63% of the gap every
 * `timeConstantMs`. Frame-rate independent, and it lands exactly on the target
 * once within `epsilon` so a settled value stops asking for frames.
 */
export function approach(
  current: number,
  target: number,
  elapsedMs: number,
  timeConstantMs: number,
  epsilon = 0.004
): number {
  if (timeConstantMs <= 0) return target;
  const next = target + (current - target) * Math.exp(-elapsedMs / timeConstantMs);
  return Math.abs(next - target) < epsilon ? target : next;
}

/**
 * The view part-way through a tween. Zoom moves geometrically and the point
 * at the centre of the screen moves in a straight line, so a fit across a big
 * zoom change neither lurches at the start nor swings sideways on the way.
 */
export function viewAt(tween: ViewTween, time: number): { view: View; done: boolean } {
  const start = tween.start ?? time;
  const t = tween.duration > 0 ? clamp01((time - start) / tween.duration) : 1;
  if (t >= 1) return { view: tween.to, done: true };
  const eased = easeInOutCubic(t);
  const zoom = tween.from.zoom * Math.pow(tween.to.zoom / tween.from.zoom, eased);
  const fromCentreX = -tween.from.x / tween.from.zoom;
  const fromCentreY = -tween.from.y / tween.from.zoom;
  const toCentreX = -tween.to.x / tween.to.zoom;
  const toCentreY = -tween.to.y / tween.to.zoom;
  return {
    view: {
      zoom,
      x: -(fromCentreX + (toCentreX - fromCentreX) * eased) * zoom,
      y: -(fromCentreY + (toCentreY - fromCentreY) * eased) * zoom,
    },
    done: false,
  };
}
