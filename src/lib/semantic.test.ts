/** Typed semantic IPC wrapper and argument-shape contract tests. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getSemanticStatus,
  getSemanticModels,
  setSemanticModel,
  setSemanticEnabled,
  semanticSearch,
  semanticRelated,
  semanticReindex,
  SEMANTIC_SEARCH_LIMIT,
  SEMANTIC_RELATED_LIMIT,
} from './semantic';

const mockInvoke = vi.mocked(invoke);

describe('semantic IPC wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  it('getSemanticStatus calls semantic_status and returns the snapshot', async () => {
    const status = {
      enabled: true,
      modelReady: true,
      indexedCount: 42,
      state: 'ready',
      error: null,
    };
    mockInvoke.mockResolvedValueOnce(status);
    await expect(getSemanticStatus()).resolves.toEqual(status);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_status', undefined);
  });

  it('setSemanticEnabled passes the enabled flag', async () => {
    await setSemanticEnabled(true);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_set_enabled', { enabled: true });
    await setSemanticEnabled(false);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_set_enabled', { enabled: false });
  });

  it('getSemanticModels returns the curated registry', async () => {
    const models = [
      {
        id: 'all-minilm-l6-v2',
        label: 'all-MiniLM-L6-v2',
        downloadSizeMb: 97,
        dims: 384,
        description: 'fastest, English-focused',
        active: true,
      },
    ];
    mockInvoke.mockResolvedValueOnce(models);
    await expect(getSemanticModels()).resolves.toEqual(models);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_models', undefined);
  });

  it('setSemanticModel passes the curated model id', async () => {
    await setSemanticModel('bge-small-en-v1.5');
    expect(mockInvoke).toHaveBeenCalledWith('semantic_set_model', {
      id: 'bge-small-en-v1.5',
    });
  });

  it('semanticSearch passes query and the default limit', async () => {
    const hits = [{ path: 'notes/a.md', title: 'A', score: 0.9 }];
    mockInvoke.mockResolvedValueOnce(hits);
    await expect(semanticSearch('meaning of life')).resolves.toEqual(hits);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_search', {
      query: 'meaning of life',
      limit: SEMANTIC_SEARCH_LIMIT,
    });
  });

  it('semanticSearch honours an explicit limit', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await semanticSearch('q', 3);
    expect(mockInvoke).toHaveBeenCalledWith('semantic_search', { query: 'q', limit: 3 });
  });

  it('semanticRelated passes a forge-relative path and the default limit', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    await semanticRelated('notes/Projects/foo.md');
    expect(mockInvoke).toHaveBeenCalledWith('semantic_related', {
      path: 'notes/Projects/foo.md',
      limit: SEMANTIC_RELATED_LIMIT,
    });
  });

  it('semanticReindex calls semantic_reindex', async () => {
    await semanticReindex();
    expect(mockInvoke).toHaveBeenCalledWith('semantic_reindex', undefined);
  });

  it('propagates sanitized backend errors', async () => {
    mockInvoke.mockRejectedValueOnce('Model load failed at /Users/eve/Library/model.bin');
    await expect(semanticSearch('q')).rejects.toThrow(/<path>/);
  });
});
