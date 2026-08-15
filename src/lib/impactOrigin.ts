export interface ImpactPoint {
  x: number;
  y: number;
}

let pendingImpactPoint: ImpactPoint | null = null;

/** Capture the centre of a clicked trigger before its opening surface mounts. */
export function impactPointFromElement(element: Element): ImpactPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function captureImpactOrigin(element: Element): void {
  pendingImpactPoint = impactPointFromElement(element);
}

export function clearImpactOrigin(): void {
  pendingImpactPoint = null;
}

/** Set the custom properties before the surface's first painted frame. */
export function applyImpactOrigin(
  surface: HTMLElement | null,
  point: ImpactPoint | null = pendingImpactPoint
): void {
  if (!surface) return;
  if (point === pendingImpactPoint) pendingImpactPoint = null;
  const rect = surface.getBoundingClientRect();
  const usablePoint = point && rect.width !== 0 && rect.height !== 0;
  const x = usablePoint ? `${((point.x - rect.left) / rect.width) * 100}%` : '50%';
  const y = usablePoint ? `${((point.y - rect.top) / rect.height) * 100}%` : '50%';
  surface.style.setProperty('--impact-x', x);
  surface.style.setProperty('--impact-y', y);
}
