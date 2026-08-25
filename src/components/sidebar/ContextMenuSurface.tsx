/**
 * Shared viewport-aware surface for pointer-positioned sidebar menus. Portaling
 * keeps fixed coordinates independent of sidebar transforms and clipping.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { applyImpactOrigin, type ImpactPoint } from '@/lib/impactOrigin';

interface Size {
  width: number;
  height: number;
}

const EDGE = 8;

export function fitContextMenuPosition(
  point: ImpactPoint,
  menu: Size,
  viewport: Size
): ImpactPoint {
  let x = point.x;
  let y = point.y;

  if (x + menu.width + EDGE > viewport.width && point.x - menu.width >= EDGE) {
    x = point.x - menu.width;
  }
  if (y + menu.height + EDGE > viewport.height && point.y - menu.height >= EDGE) {
    y = point.y - menu.height;
  }

  return {
    x: Math.max(EDGE, Math.min(x, viewport.width - menu.width - EDGE)),
    y: Math.max(EDGE, Math.min(y, viewport.height - menu.height - EDGE)),
  };
}

interface ContextMenuSurfaceProps {
  position: ImpactPoint;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenuSurface({ position, onClose, children }: ContextMenuSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const place = () => {
      const fitted = fitContextMenuPosition(
        position,
        { width: surface.offsetWidth, height: surface.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      surface.style.left = `${fitted.x}px`;
      surface.style.top = `${fitted.y}px`;
    };
    const closeOnOutsideScroll = (event: Event) => {
      if (event.target === surface) return;
      onClose();
    };

    place();
    applyImpactOrigin(surface, position);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', closeOnOutsideScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', closeOnOutsideScroll, true);
    };
  }, [onClose, position]);

  return createPortal(
    <div
      ref={surfaceRef}
      // The flex column is required for WebKit shrink-to-fit sizing when a
      // menu contains both full-width actions and a plain separator.
      className="sidebar-context-menu fixed z-[9999] flex flex-col py-1 min-w-[160px] modal-content-enter impact-surface"
      style={{
        left: position.x,
        top: position.y,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
