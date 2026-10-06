import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContentMatch } from '@/stores';
import { SidebarSearchResults } from './SidebarSearchResults';

const match = (n: number): ContentMatch => ({
  filename: `note-${n}.md`,
  path: `notes/note-${n}.md`,
  snippet: 'a few words',
  lineNumber: 1,
  matchCount: 1,
  isDaily: false,
  isWeekly: false,
  folderPath: null,
});

describe('SidebarSearchResults', () => {
  // The results scroll inside their own area, and the arrow keys move the
  // selection without moving focus, so the list has to follow it.
  it('scrolls the selected result into view as the selection moves', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const results = Array.from({ length: 30 }, (_, i) => match(i));
    const props = {
      query: 'few',
      results,
      loading: false,
      onSelect: vi.fn(),
      onOpen: vi.fn(),
      onClear: vi.fn(),
    };
    const { rerender, getAllByRole } = render(
      <SidebarSearchResults {...props} selectedIndex={0} />
    );

    rerender(<SidebarSearchResults {...props} selectedIndex={24} />);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[scrollIntoView.mock.contexts.length - 1]).toBe(
      getAllByRole('option')[24]
    );
  });
});
