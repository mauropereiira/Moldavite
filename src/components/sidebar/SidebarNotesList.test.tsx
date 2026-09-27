import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SortOption } from '@/stores/settingsStore';
import { SidebarNotesList } from './SidebarNotesList';

function renderList(sortOption: SortOption) {
  render(
    <SidebarNotesList
      notes={[]}
      isCollapsed={false}
      onToggleSection={vi.fn()}
      count={0}
      title="Notes"
      sortOption={sortOption}
      onSortToggle={vi.fn()}
      onNewNote={vi.fn()}
      onNoteClick={vi.fn()}
      onNoteContextMenu={vi.fn()}
      isNoteActive={() => false}
      isDragOverRoot={false}
      onRootDragEnter={vi.fn()}
      onRootDragOver={vi.fn()}
      onRootDragLeave={vi.fn()}
      onRootDrop={vi.fn()}
      showEmptyState={false}
      showFilteredEmptyState={false}
      filteredEmptyTagCount={0}
    />
  );
}

describe('SidebarNotesList sort control', () => {
  it.each([
    ['name-asc', 'A–Z'],
    ['name-desc', 'Z–A'],
    ['manual', 'Manual'],
    ['modified-desc', 'Modified (newest)'],
    ['modified-asc', 'Modified (oldest)'],
    ['created-desc', 'Created (newest)'],
    ['created-asc', 'Created (oldest)'],
  ] as const)('names the sort in force: %s', (sortOption, label) => {
    renderList(sortOption);
    expect(screen.getByRole('button', { name: `Sort: ${label}` })).toHaveTextContent(label);
  });
});
