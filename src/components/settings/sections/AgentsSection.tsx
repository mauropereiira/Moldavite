/**
 * AgentsSection, "AI & Agents": in order, the agent-ready Forge (an
 * `AGENTS.md` describing the vault's conventions plus a `.gitignore` for
 * app-managed directories, written through the whitelisted
 * `write_forge_root_file` command), the built-in MCP server, then semantic
 * search and the keyword index.
 */

import { useState, useEffect, useCallback } from 'react';
import { FileCheck2, RefreshCw, Sparkles } from 'lucide-react';
import { useForgeStore } from '@/stores/forgeStore';
import { useSemanticStore } from '@/stores';
import { useToast } from '@/hooks/useToast';
import { ConfirmDialog } from '@/components/ui';
import { DotLoader } from '@/components/ui/DotLoader';
import type { SemanticModelInfo } from '@/lib/semantic';
import {
  getSearchIndexStatus,
  rebuildSearchIndex,
  type SearchIndexStatus,
} from '@/lib/searchIndex';
import type { McpClient } from '@/lib';
import {
  buildMcpSetupSnippet,
  buildAgentsMd,
  getAppBinaryPath,
  getMcpWritesEnabled,
  GITIGNORE_CONTENT,
  MCP_CLIENT_OPTIONS,
  readForgeRootFile,
  setMcpWritesEnabled,
  writeForgeRootFile,
} from '@/lib';
import { Group, Row, SegmentedControl, Toggle, ToggleRow } from '../common';

export function AgentsSection() {
  const forgeName = useForgeStore((s) => s.active);
  const toast = useToast();
  const [agentsMdExists, setAgentsMdExists] = useState<boolean | null>(null);
  const [isWriting, setIsWriting] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState<string[] | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const content = await readForgeRootFile('AGENTS.md');
      setAgentsMdExists(content !== null);
    } catch (error) {
      console.error('[Settings] Failed to check AGENTS.md:', error);
      setAgentsMdExists(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const writeFiles = useCallback(async () => {
    setIsWriting(true);
    try {
      await writeForgeRootFile('AGENTS.md', buildAgentsMd(forgeName ?? ''), true);
      await writeForgeRootFile('.gitignore', GITIGNORE_CONTENT, true);
      toast.success('AGENTS.md and .gitignore written to your Forge');
    } catch (error) {
      console.error('[Settings] Failed to write agent files:', error);
      toast.error(`Failed to write agent files: ${error instanceof Error ? error.message : error}`);
    } finally {
      setIsWriting(false);
      void refreshStatus();
    }
  }, [forgeName, toast, refreshStatus]);

  const handleMakeAgentReady = useCallback(async () => {
    try {
      const [agents, gitignore] = await Promise.all([
        readForgeRootFile('AGENTS.md'),
        readForgeRootFile('.gitignore'),
      ]);
      const existing = [
        ...(agents !== null ? ['AGENTS.md'] : []),
        ...(gitignore !== null ? ['.gitignore'] : []),
      ];
      if (existing.length > 0) {
        setConfirmOverwrite(existing);
        return;
      }
      await writeFiles();
    } catch (error) {
      console.error('[Settings] Failed to prepare agent files:', error);
      toast.error('Failed to check existing files');
    }
  }, [writeFiles, toast]);

  return (
    <div className="settings-tab">
      <Group id="agent-ready">
        <Row
          id="agents-md"
          note={
            agentsMdExists !== null &&
            (agentsMdExists ? (
              <span className="settings-ok inline-flex items-center gap-1">
                <FileCheck2 aria-hidden="true" className="w-3.5 h-3.5" />
                AGENTS.md is in this Forge
              </span>
            ) : (
              'No AGENTS.md yet'
            ))
          }
        >
          <button onClick={handleMakeAgentReady} disabled={isWriting} className="settings-btn">
            <Sparkles aria-hidden="true" className="w-4 h-4" />
            {isWriting ? 'Writing...' : 'Make this Forge agent-ready'}
          </button>
        </Row>
      </Group>

      <McpServerBlock />

      <Group id="search">
        <SemanticSearchBlock />
        <SearchIndexBlock />
      </Group>

      {/* Overwrite confirmation */}
      {confirmOverwrite && (
        <ConfirmDialog
          title="Overwrite existing files?"
          message={`${confirmOverwrite.join(' and ')} already exist${confirmOverwrite.length === 1 ? 's' : ''} in this Forge. Overwrite with freshly generated content?`}
          confirmLabel="Overwrite"
          onConfirm={() => {
            setConfirmOverwrite(null);
            void writeFiles();
          }}
          onCancel={() => setConfirmOverwrite(null)}
        />
      )}
    </div>
  );
}

function McpServerBlock() {
  const toast = useToast();
  const [binaryPath, setBinaryPath] = useState('');
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [confirmWrites, setConfirmWrites] = useState(false);
  const [client, setClient] = useState<McpClient>('claude-code');

  useEffect(() => {
    Promise.all([getAppBinaryPath(), getMcpWritesEnabled()])
      .then(([path, enabled]) => {
        setBinaryPath(path || '');
        setWritesEnabled(enabled);
      })
      .catch((error) => {
        console.error('[Settings] Failed to load MCP settings:', error);
        toast.error('Failed to load MCP server settings');
      });
  }, [toast]);

  const setupSnippet = buildMcpSetupSnippet(client, binaryPath);
  const selectedClient = MCP_CLIENT_OPTIONS.find((option) => option.id === client);
  const setupLabels: Record<McpClient, string> = {
    'claude-code': 'Run in your terminal',
    'claude-desktop': 'Add to claude_desktop_config.json',
    cursor: 'Save as .cursor/mcp.json',
    generic: 'Generic MCP server entry',
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      console.error('[Settings] Failed to copy MCP setup:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  const persistWrites = (enabled: boolean) => {
    setMcpWritesEnabled(enabled)
      .then(() => setWritesEnabled(enabled))
      .catch((error) => {
        console.error('[Settings] Failed to update MCP write access:', error);
        toast.error('Failed to update MCP write access');
      });
  };

  const handleWritesToggle = (enabled: boolean) => {
    if (enabled) {
      setConfirmWrites(true);
    } else {
      persistWrites(false);
    }
  };

  return (
    <Group id="mcp">
      <Row id="mcp-client" stack>
        <SegmentedControl
          ariaLabel="MCP client"
          value={client}
          onChange={setClient}
          options={MCP_CLIENT_OPTIONS.map((option) => ({
            value: option.id,
            label: option.label,
          }))}
        />
        <SetupSnippet
          label={`${selectedClient?.label ?? 'MCP client'}: ${setupLabels[client]}`}
          value={setupSnippet}
          disabled={!binaryPath}
          onCopy={() => void copy(setupSnippet)}
        />
      </Row>

      <ToggleRow id="mcp-writes" value={writesEnabled} onChange={handleWritesToggle} />

      <Row
        id="mcp-path"
        detail={
          <span className="settings-path-block">
            {binaryPath || 'Locating Moldavite...'}
            {binaryPath.includes('target/debug') && ' (development build)'}
          </span>
        }
      >
        <button
          type="button"
          onClick={() => void copy(binaryPath)}
          disabled={!binaryPath}
          className="settings-btn"
          aria-label="Copy path to your Moldavite install"
        >
          Copy path
        </button>
      </Row>

      {confirmWrites && (
        <ConfirmDialog
          title="Allow agents to write notes?"
          message="Connected MCP agents will be able to create notes, fully replace existing unlocked notes, and append to daily notes in your Forges. Locked notes remain inaccessible."
          confirmLabel="Allow writes"
          onConfirm={() => {
            setConfirmWrites(false);
            persistWrites(true);
          }}
          onCancel={() => setConfirmWrites(false)}
        />
      )}
    </Group>
  );
}

function SetupSnippet({
  label,
  value,
  disabled,
  onCopy,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="settings-snippet">
      <div className="flex items-center justify-between gap-2 mt-1 mb-1.5 text-xs">
        <span>{label}</span>
        <button
          type="button"
          onClick={onCopy}
          disabled={disabled}
          className="settings-btn"
          aria-label={`Copy ${label}`}
        >
          Copy
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs whitespace-pre-wrap break-all">{value}</pre>
    </div>
  );
}

/**
 * "Semantic search" block: consent-gated enable toggle, live download/index
 * progress (streamed via `semantic:*` events into `semanticStore`), and a
 * rebuild-index action.
 */
function SemanticSearchBlock() {
  const semantic = useSemanticStore();
  const refreshStatus = useSemanticStore((s) => s.refreshStatus);
  const toast = useToast();
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [pendingModel, setPendingModel] = useState<SemanticModelInfo | null>(null);

  // Settings can open long after startup; re-sync with the backend so the
  // indexed count / state shown here is fresh. (Store actions are stable.)
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const isBuilding = semantic.state === 'downloading' || semantic.state === 'indexing';
  const isUnsupported = semantic.state === 'unsupported';
  const activeModel = semantic.models.find((model) => model.active);

  const handleToggle = (enabled: boolean) => {
    if (enabled) {
      // Consent BEFORE anything downloads.
      setConfirmEnable(true);
      return;
    }
    semantic.setEnabled(false).catch((error) => {
      console.error('[Settings] Failed to disable semantic search:', error);
      toast.error('Failed to disable semantic search');
    });
  };

  const handleConfirmEnable = () => {
    setConfirmEnable(false);
    semantic.setEnabled(true).catch((error) => {
      console.error('[Settings] Failed to enable semantic search:', error);
      toast.error('Failed to enable semantic search');
    });
  };

  const handleRebuild = () => {
    semantic.rebuildIndex().catch((error) => {
      console.error('[Settings] Failed to rebuild semantic index:', error);
      toast.error('Failed to rebuild the semantic index');
    });
  };

  const applyModel = (id: string) => {
    semantic.setModel(id).catch(() => {
      toast.error('Failed to change the semantic search model');
    });
  };

  const handleModelChange = (id: string) => {
    const model = semantic.models.find((candidate) => candidate.id === id);
    if (!model || model.active) return;
    if (semantic.enabled) {
      setPendingModel(model);
    } else {
      applyModel(model.id);
    }
  };

  return (
    <>
      <Row
        id="semantic"
        note={
          isUnsupported ? (
            `${semantic.error ?? 'Semantic search requires Apple Silicon on macOS'}. Keyword search remains available.`
          ) : semantic.enabled ? (
            <SemanticStatusLine />
          ) : null
        }
      >
        {!isUnsupported && semantic.enabled && (
          <button onClick={handleRebuild} disabled={isBuilding} className="settings-btn">
            {isBuilding ? (
              <DotLoader label="Building semantic index" />
            ) : (
              <RefreshCw aria-hidden="true" className="w-4 h-4" />
            )}
            {isBuilding ? 'Building...' : 'Rebuild index'}
          </button>
        )}
        {!isUnsupported && (
          <Toggle
            enabled={semantic.enabled}
            onChange={handleToggle}
            ariaLabel="Enable semantic search"
          />
        )}
      </Row>

      {!isUnsupported && (
        <Row id="semantic-model">
          <select
            aria-label="Semantic search model"
            value={activeModel?.id ?? ''}
            onChange={(event) => handleModelChange(event.target.value)}
            disabled={isBuilding}
            className="settings-input"
          >
            {semantic.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}, ~{model.downloadSizeMb} MB, {model.description}
              </option>
            ))}
          </select>
        </Row>
      )}

      {confirmEnable && !isUnsupported && (
        <ConfirmDialog
          title="Enable semantic search?"
          message={`Downloads ${activeModel?.label ?? 'the selected model'}${activeModel ? ` (~${activeModel.downloadSizeMb} MB)` : ''} once from HuggingFace. After that everything runs offline and your notes never leave your Mac. Your notes are then indexed locally so you can search by meaning.`}
          confirmLabel="Download & enable"
          onConfirm={handleConfirmEnable}
          onCancel={() => setConfirmEnable(false)}
        />
      )}

      {pendingModel && !isUnsupported && (
        <ConfirmDialog
          title={`Switch to ${pendingModel.label}?`}
          message={`Downloads ${pendingModel.label} (~${pendingModel.downloadSizeMb} MB) once and re-indexes your notes.`}
          confirmLabel="Download & re-index"
          onConfirm={() => {
            const id = pendingModel.id;
            setPendingModel(null);
            applyModel(id);
          }}
          onCancel={() => setPendingModel(null)}
        />
      )}
    </>
  );
}

function SemanticStatusLine() {
  const { state, progress, indexedCount, error } = useSemanticStore();

  if (state === 'downloading') return <>Downloading model...</>;
  if (state === 'indexing') {
    const detail =
      progress && progress.phase === 'indexing' && progress.total > 0
        ? ` ${progress.done}/${progress.total}`
        : '';
    return <>Indexing notes...{detail}</>;
  }
  if (state === 'error') {
    return (
      <span className="settings-error" role="alert">
        {error ?? 'Semantic search hit an error'}
      </span>
    );
  }
  if (state === 'ready') {
    return (
      <>
        {indexedCount} {indexedCount === 1 ? 'note' : 'notes'} indexed, ready
      </>
    );
  }
  return null;
}

/** How often to re-poll `search_index_status` while a rebuild is running. */
const SEARCH_INDEX_POLL_MS = 2000;

/** "rebuilt 3 minutes ago" or "rebuilt 2 hours ago"; no relative-time helper exists yet. */
function formatRebuiltAgo(lastReconcileMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - lastReconcileMs) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function searchIndexStatusText(status: SearchIndexStatus): string {
  if (status.building) return 'Indexing...';
  if (!status.ready) return 'Not built yet';
  const notes = `${status.noteCount} ${status.noteCount === 1 ? 'note' : 'notes'} indexed`;
  return status.lastReconcileMs !== null
    ? `${notes}, rebuilt ${formatRebuiltAgo(status.lastReconcileMs)}`
    : notes;
}

/**
 * "Search index" block: shows the on-disk keyword index's build status and a
 * manual rebuild action. Rebuilds run in the background, so this polls the
 * status while one is in progress and stops once it clears.
 */
function SearchIndexBlock() {
  const toast = useToast();
  const [status, setStatus] = useState<SearchIndexStatus | null>(null);

  // Returns the fetched status rather than setting state itself, so the
  // `useEffect`s below own their own state updates.
  const fetchStatus = useCallback(async (): Promise<SearchIndexStatus | null> => {
    try {
      return await getSearchIndexStatus();
    } catch (error) {
      console.error('[Settings] Failed to load search index status:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchStatus().then((next) => {
      if (next) setStatus(next);
    });
  }, [fetchStatus]);

  useEffect(() => {
    if (!status?.building) return;
    const timer = setInterval(() => {
      fetchStatus().then((next) => {
        if (next) setStatus(next);
      });
    }, SEARCH_INDEX_POLL_MS);
    return () => clearInterval(timer);
  }, [status?.building, fetchStatus]);

  const handleRebuild = () => {
    setStatus((prev) => (prev ? { ...prev, building: true } : prev));
    rebuildSearchIndex()
      .then(() => fetchStatus())
      .then((next) => {
        if (next) setStatus(next);
      })
      .catch((error) => {
        console.error('[Settings] Failed to rebuild search index:', error);
        toast.error('Failed to rebuild the search index');
        void fetchStatus().then((next) => {
          if (next) setStatus(next);
        });
      });
  };

  const isBuilding = status?.building ?? false;

  return (
    <Row id="search-index" note={status && searchIndexStatusText(status)}>
      <button onClick={handleRebuild} disabled={isBuilding} className="settings-btn">
        {isBuilding ? (
          <DotLoader label="Rebuilding search index" />
        ) : (
          <RefreshCw aria-hidden="true" className="w-4 h-4" />
        )}
        {isBuilding ? 'Building...' : 'Rebuild search index'}
      </button>
    </Row>
  );
}
