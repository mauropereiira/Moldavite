import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrashPopover } from './TrashPopover';
import type { TrashedNote } from '@/types';

function anchorAt(left: number, width = 48) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () =>
    ({ left, right: left + width, top: 700, bottom: 740, width, height: 40 }) as DOMRect;
  return anchor;
}

function renderPopover(anchor: HTMLElement, trashedNotes: TrashedNote[] = []) {
  render(
    <TrashPopover
      isOpen
      anchor={anchor}
      trashedNotes={trashedNotes}
      onClose={vi.fn()}
      onRestore={vi.fn()}
      onPermanentDelete={vi.fn()}
      onEmptyTrash={vi.fn()}
      onPreview={vi.fn()}
    />
  );
  return screen.getByRole('dialog');
}

describe('TrashPopover placement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens to the right of an anchor on the left edge', () => {
    const popover = renderPopover(anchorAt(0));
    expect(popover.style.left).toBe('60px');
  });

  it('opens to the left of an anchor on the right edge, clear of the rail', () => {
    const railLeft = window.innerWidth - 48;
    const popover = renderPopover(anchorAt(railLeft));
    expect(popover.style.left).toBe(`${railLeft - 12 - 380}px`);
  });
});

describe('TrashPopover items', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // A trashed locked note keeps its ciphertext under `<name>.md.locked`.
  it('names a locked note by its title and says it is locked', () => {
    renderPopover(anchorAt(0), [
      {
        id: '1',
        filename: 'Diary.md.locked',
        originalPath: 'Diary.md.locked',
        isDaily: false,
        isWeekly: false,
        isFolder: false,
        containedFiles: [],
        trashedAt: 0,
        daysRemaining: 7,
      },
    ]);

    expect(screen.getByText('Diary')).toBeInTheDocument();
    expect(screen.getByText(/^Locked · /)).toBeInTheDocument();
  });
});

describe('TrashPopover Escape', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // The window's Esc handler closes the open note unless Escape was handled.
  // The popover unmounts before that handler runs, so it cannot see the dialog.
  it('closes itself and marks Escape handled', () => {
    const onClose = vi.fn();
    render(
      <TrashPopover
        isOpen
        anchor={anchorAt(0)}
        trashedNotes={[]}
        onClose={onClose}
        onRestore={vi.fn()}
        onPermanentDelete={vi.fn()}
        onEmptyTrash={vi.fn()}
        onPreview={vi.fn()}
      />
    );
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(onClose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('TrashPopover height and dragging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup(height: number) {
    let measuredHeight = height;
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.getAttribute('aria-label') === 'Trash' ? measuredHeight : 0;
    });
    const anchor = anchorAt(0);
    const props = {
      anchor,
      trashedNotes: [] as TrashedNote[],
      onClose: vi.fn(),
      onRestore: vi.fn(),
      onPermanentDelete: vi.fn(),
      onEmptyTrash: vi.fn(),
      onPreview: vi.fn(),
    };
    const view = render(<TrashPopover isOpen {...props} />);
    return {
      ...view,
      props,
      setHeight: (height: number) => {
        measuredHeight = height;
      },
    };
  }

  it.each([80, 180, 520])('aligns the bottom to the anchor for a %ipx popover', (height) => {
    setup(height);
    expect(Number.parseFloat(screen.getByRole('dialog').style.top) + height).toBe(740);
  });

  it('keeps a dragged position on reopening and clamps the whole popover inside the viewport', () => {
    const { rerender, unmount, props } = setup(180);
    let popover = screen.getByRole('dialog');
    const top = Number.parseFloat(popover.style.top);
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Trash' }), {
      clientX: 80,
      clientY: top + 10,
    });
    fireEvent.mouseMove(document, { clientX: 220, clientY: 310 });
    fireEvent.mouseUp(document);
    expect(popover.style.top).toBe('300px');
    expect(popover.style.left).toBe('200px');
    rerender(<TrashPopover isOpen={false} {...props} />);
    rerender(<TrashPopover isOpen {...props} />);
    expect(screen.getByRole('dialog').style.top).toBe('300px');
    expect(screen.getByRole('dialog').style.left).toBe('200px');
    popover = screen.getByRole('dialog');
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Trash' }), {
      clientX: 220,
      clientY: 310,
    });
    fireEvent.mouseMove(document, { clientX: 5000, clientY: 5000 });
    fireEvent.mouseUp(document);
    expect(Number.parseFloat(popover.style.top) + 180).toBeLessThanOrEqual(window.innerHeight - 12);
    expect(Number.parseFloat(popover.style.left) + 380).toBeLessThanOrEqual(window.innerWidth - 12);
    const draggedTop = popover.style.top;
    unmount();
    render(<TrashPopover isOpen {...props} />);
    expect(screen.getByRole('dialog').style.top).toBe(draggedTop);
  });
});
