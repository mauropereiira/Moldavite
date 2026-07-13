import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useSearchStore } from './searchStore';

const mockInvoke = vi.mocked(invoke);

const keywordHit = {
  filename: 'foo.md',
  path: 'notes/foo.md',
  snippet: 'foo bar',
  lineNumber: 1,
  matchCount: 1,
  isDaily: false,
  isWeekly: false,
  folderPath: null,
};

const semanticHit = { path: 'notes/foo.md', title: 'Foo', score: 0.91 };

async function flushDebounce() {
  await vi.advanceTimersByTimeAsync(200);
}

describe('searchStore semantic mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
    useSearchStore.setState({
      query: '',
      mode: 'keyword',
      results: [],
      semanticResults: [],
      loading: false,
      selectedIndex: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keyword mode queries search_notes_content', async () => {
    mockInvoke.mockResolvedValueOnce([keywordHit]);
    useSearchStore.getState().setQuery('foo');
    await flushDebounce();
    expect(mockInvoke).toHaveBeenCalledWith(
      'search_notes_content',
      expect.objectContaining({ query: 'foo' })
    );
    expect(useSearchStore.getState().results).toEqual([keywordHit]);
  });

  it('semantic mode queries semantic_search into semanticResults', async () => {
    useSearchStore.setState({ mode: 'semantic' });
    mockInvoke.mockResolvedValueOnce([semanticHit]);
    useSearchStore.getState().setQuery('meaning');
    await flushDebounce();
    expect(mockInvoke).toHaveBeenCalledWith(
      'semantic_search',
      expect.objectContaining({ query: 'meaning' })
    );
    const s = useSearchStore.getState();
    expect(s.semanticResults).toEqual([semanticHit]);
    expect(s.results).toEqual([]);
  });

  it('setMode re-runs the current query under the new engine', async () => {
    mockInvoke.mockResolvedValueOnce([keywordHit]);
    useSearchStore.getState().setQuery('foo');
    await flushDebounce();

    mockInvoke.mockResolvedValueOnce([semanticHit]);
    useSearchStore.getState().setMode('semantic');
    await flushDebounce();

    expect(mockInvoke).toHaveBeenLastCalledWith(
      'semantic_search',
      expect.objectContaining({ query: 'foo' })
    );
    expect(useSearchStore.getState().semanticResults).toEqual([semanticHit]);
  });

  it('setMode with the same mode is a no-op', () => {
    useSearchStore.getState().setMode('keyword');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('clear wipes both result lists', async () => {
    useSearchStore.setState({
      query: 'x',
      results: [keywordHit],
      semanticResults: [semanticHit],
      selectedIndex: 1,
    });
    useSearchStore.getState().clear();
    const s = useSearchStore.getState();
    expect(s.query).toBe('');
    expect(s.results).toEqual([]);
    expect(s.semanticResults).toEqual([]);
    expect(s.selectedIndex).toBe(0);
  });

  it('moveSelection is bounded by the active mode result list', () => {
    useSearchStore.setState({
      mode: 'semantic',
      results: [keywordHit, keywordHit, keywordHit],
      semanticResults: [semanticHit],
      selectedIndex: 0,
    });
    useSearchStore.getState().moveSelection(1);
    // Only one semantic hit → stays clamped at 0 despite 3 keyword results.
    expect(useSearchStore.getState().selectedIndex).toBe(0);
  });

  it('collapses rapid query spam to the final query', async () => {
    mockInvoke.mockResolvedValue([keywordHit]);
    for (let i = 0; i < 250; i += 1) {
      useSearchStore.getState().setQuery(`query-${i}`);
    }
    await flushDebounce();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(
      'search_notes_content',
      expect.objectContaining({ query: 'query-249' })
    );
    expect(useSearchStore.getState()).toMatchObject({
      query: 'query-249',
      results: [keywordHit],
      loading: false,
    });
  });

  it('ignores stale responses while modes switch rapidly', async () => {
    let resolveKeyword!: (value: (typeof keywordHit)[]) => void;
    const keyword = new Promise<(typeof keywordHit)[]>((resolve) => {
      resolveKeyword = resolve;
    });
    mockInvoke.mockReturnValueOnce(keyword).mockResolvedValueOnce([semanticHit]);

    useSearchStore.getState().setQuery('same query');
    await flushDebounce();
    useSearchStore.getState().setMode('semantic');
    await flushDebounce();
    resolveKeyword([keywordHit]);
    await Promise.resolve();

    expect(useSearchStore.getState()).toMatchObject({
      mode: 'semantic',
      results: [],
      semanticResults: [semanticHit],
      loading: false,
    });
  });
});
