import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  SearchModeChips,
  SidebarSemanticResults,
} from './SidebarSemanticSearch';
import type { SemanticHit } from '@/lib/semantic';

const hits: SemanticHit[] = [
  { path: 'notes/Projects/roadmap.md', title: 'Roadmap', score: 0.91 },
  { path: 'daily/2026-07-12.md', title: '2026-07-12', score: 0.42 },
];

describe('SearchModeChips', () => {
  it('marks the active mode and switches on click', () => {
    const onModeChange = vi.fn();
    render(<SearchModeChips mode="keyword" onModeChange={onModeChange} />);

    const keyword = screen.getByRole('button', { name: 'Keyword' });
    const semantic = screen.getByRole('button', { name: /semantic/i });
    expect(keyword).toHaveAttribute('aria-pressed', 'true');
    expect(semantic).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(semantic);
    expect(onModeChange).toHaveBeenCalledWith('semantic');
  });
});

describe('SidebarSemanticResults', () => {
  const baseProps = {
    query: 'planning',
    loading: false,
    selectedIndex: 0,
    onSelect: vi.fn(),
    onClear: vi.fn(),
  };

  it('renders hits with title, similarity and folder, and opens on click', () => {
    const onOpen = vi.fn();
    render(<SidebarSemanticResults {...baseProps} hits={hits} onOpen={onOpen} />);

    expect(screen.getByText('2 matches by meaning')).toBeInTheDocument();
    expect(screen.getByText('Roadmap')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.getByText('in Projects')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /roadmap/i }));
    expect(onOpen).toHaveBeenCalledWith(hits[0]);
  });

  it('shows the shared empty state when there are no hits', () => {
    render(<SidebarSemanticResults {...baseProps} hits={[]} onOpen={vi.fn()} />);
    expect(screen.getByText('0 matches by meaning')).toBeInTheDocument();
    // NoSearchResultsEmptyState echoes the query.
    expect(screen.getByText(/planning/)).toBeInTheDocument();
  });
});
