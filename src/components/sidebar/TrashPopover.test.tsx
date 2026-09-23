import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrashPopover } from './TrashPopover';

function anchorAt(left: number, width = 48) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () =>
    ({ left, right: left + width, top: 700, bottom: 740, width, height: 40 }) as DOMRect;
  return anchor;
}

function renderPopover(anchor: HTMLElement) {
  render(
    <TrashPopover
      isOpen
      anchor={anchor}
      trashedNotes={[]}
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
