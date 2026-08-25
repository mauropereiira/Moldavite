import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContextMenuSurface, fitContextMenuPosition } from './ContextMenuSurface';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fitContextMenuPosition', () => {
  it('keeps a menu at the requested point when it fits', () => {
    expect(
      fitContextMenuPosition(
        { x: 20, y: 30 },
        { width: 80, height: 100 },
        { width: 400, height: 300 }
      )
    ).toEqual({ x: 20, y: 30 });
  });

  it('flips a menu away from the right and bottom edges', () => {
    expect(
      fitContextMenuPosition(
        { x: 390, y: 290 },
        { width: 160, height: 120 },
        { width: 400, height: 300 }
      )
    ).toEqual({ x: 230, y: 170 });
  });

  it('clamps when the menu fits on neither side', () => {
    expect(
      fitContextMenuPosition(
        { x: 60, y: 60 },
        { width: 100, height: 100 },
        { width: 120, height: 120 }
      )
    ).toEqual({ x: 12, y: 12 });
  });

  it('keeps an oversized menu anchored to the viewport margin', () => {
    expect(
      fitContextMenuPosition(
        { x: 60, y: 60 },
        { width: 200, height: 200 },
        { width: 120, height: 120 }
      )
    ).toEqual({ x: 8, y: 8 });
  });
});

describe('ContextMenuSurface', () => {
  function mockGeometry(width = 160, height = 120) {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(height);
  }

  it('portals to the body and fits the measured menu before paint', () => {
    vi.stubGlobal('innerWidth', 300);
    vi.stubGlobal('innerHeight', 200);
    mockGeometry();

    render(
      <div data-testid="clipping-parent">
        <ContextMenuSurface position={{ x: 290, y: 190 }} onClose={vi.fn()}>
          <button>Action</button>
        </ContextMenuSurface>
      </div>
    );

    const surface = screen.getByRole('button', { name: 'Action' }).parentElement;
    expect(surface?.parentElement).toBe(document.body);
    expect(surface).toHaveStyle({ left: '130px', top: '70px' });
    expect(surface).toHaveClass('sidebar-context-menu');
  });

  it('repositions when the viewport changes', () => {
    vi.stubGlobal('innerWidth', 500);
    vi.stubGlobal('innerHeight', 400);
    mockGeometry(100, 100);

    render(
      <ContextMenuSurface position={{ x: 450, y: 350 }} onClose={vi.fn()}>
        <button>Action</button>
      </ContextMenuSurface>
    );
    const surface = screen.getByRole('button', { name: 'Action' }).parentElement;
    expect(surface).toHaveStyle({ left: '350px', top: '250px' });

    vi.stubGlobal('innerWidth', 300);
    vi.stubGlobal('innerHeight', 200);
    fireEvent(window, new Event('resize'));
    expect(surface).toHaveStyle({ left: '192px', top: '92px' });
  });

  it('closes on outside scroll but stays open for its own scrollbar', () => {
    vi.stubGlobal('innerWidth', 300);
    vi.stubGlobal('innerHeight', 200);
    mockGeometry();
    const onClose = vi.fn();
    const outsideScroller = document.createElement('div');
    document.body.appendChild(outsideScroller);

    render(
      <ContextMenuSurface position={{ x: 20, y: 20 }} onClose={onClose}>
        <button>Action</button>
      </ContextMenuSurface>
    );
    const surface = screen.getByRole('button', { name: 'Action' }).parentElement as HTMLElement;

    fireEvent.scroll(surface);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.scroll(outsideScroller);
    expect(onClose).toHaveBeenCalledOnce();
    outsideScroller.remove();
  });

  it('contains portal clicks and removes lifecycle listeners on unmount', () => {
    vi.stubGlobal('innerWidth', 300);
    vi.stubGlobal('innerHeight', 200);
    mockGeometry();
    const onClose = vi.fn();
    const documentClick = vi.fn();
    document.addEventListener('click', documentClick);

    const { unmount } = render(
      <ContextMenuSurface position={{ x: 20, y: 20 }} onClose={onClose}>
        <button>Action</button>
      </ContextMenuSurface>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Action' }));
    expect(documentClick).not.toHaveBeenCalled();

    unmount();
    fireEvent.scroll(document);
    expect(onClose).not.toHaveBeenCalled();
    document.removeEventListener('click', documentClick);
  });
});
