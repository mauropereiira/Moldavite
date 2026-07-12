/**
 * AgentsSection — "AI & Agents": make the active Forge agent-ready.
 *
 * A Forge is already plain Markdown on disk, so AI agents (Claude Code, etc.)
 * can work with it directly. This section writes an `AGENTS.md` describing
 * the vault's conventions plus a `.gitignore` for app-managed directories,
 * via the whitelisted `write_forge_root_file` backend command.
 */

import { useState, useEffect, useCallback } from 'react';
import { Bot, FileCheck2, FileX2, RefreshCw, Sparkles } from 'lucide-react';
import { useForgeStore } from '@/stores/forgeStore';
import { useSemanticStore } from '@/stores';
import { useToast } from '@/hooks/useToast';
import { ConfirmDialog } from '@/components/ui';
import type { SemanticModelInfo } from '@/lib/semantic';
import {
  buildAgentsMd,
  getAppBinaryPath,
  getMcpWritesEnabled,
  GITIGNORE_CONTENT,
  readForgeRootFile,
  setMcpWritesEnabled,
  writeForgeRootFile,
} from '@/lib';
import { InfoTooltip, Toggle } from '../common';

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
    <div className="space-y-6">
      {/* Explainer */}
      <div
        className="p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-subtle)' }}
          >
            <Bot className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Your Forge is agent-friendly by design
              </h3>
              <InfoTooltip text="Notes are plain Markdown files with YAML frontmatter — no export, plugin, or API needed for an agent to read them." />
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Point an AI agent (Claude Code, or any tool that reads files) at your Forge folder and
              it can read and write your notes directly — they&apos;re plain Markdown on disk.
            </p>
          </div>
        </div>
      </div>

      {/* Make agent-ready */}
      <div
        className="p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Make this Forge agent-ready
            </h3>
            <InfoTooltip text="Writes AGENTS.md (vault layout, note naming, frontmatter, wiki-link and tag syntax, rules for agents) and a .gitignore covering the app-managed .trash/, .plugins/, and .index/ directories." />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Writes an <code>AGENTS.md</code> describing this vault&apos;s conventions to agents,
            plus a <code>.gitignore</code> for app-managed folders — both at the root of your Forge.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleMakeAgentReady}
            disabled={isWriting}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
          >
            <Sparkles aria-hidden="true" className="w-4 h-4" />
            {isWriting ? 'Writing…' : 'Make this Forge agent-ready'}
          </button>

          {agentsMdExists !== null && (
            <span
              className="flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {agentsMdExists ? (
                <>
                  <FileCheck2
                    aria-hidden="true"
                    className="w-3.5 h-3.5"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                  AGENTS.md exists in this Forge
                </>
              ) : (
                <>
                  <FileX2 aria-hidden="true" className="w-3.5 h-3.5" />
                  No AGENTS.md yet
                </>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Semantic search */}
      <SemanticSearchBlock />

      {/* Built-in MCP server */}
      <McpServerBlock />

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

  useEffect(() => {
    Promise.all([getAppBinaryPath(), getMcpWritesEnabled()])
      .then(([path, enabled]) => {
        setBinaryPath(path);
        setWritesEnabled(enabled);
      })
      .catch((error) => {
        console.error('[Settings] Failed to load MCP settings:', error);
        toast.error('Failed to load MCP server settings');
      });
  }, [toast]);

  const cliCommand = binaryPath
    ? `claude mcp add moldavite -- "${binaryPath}" --mcp`
    : 'Locating Moldavite binary…';
  const desktopJson = binaryPath
    ? JSON.stringify(
        { mcpServers: { moldavite: { command: binaryPath, args: ['--mcp'] } } },
        null,
        2
      )
    : 'Locating Moldavite binary…';

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
    <div
      className="p-4 space-y-4"
      style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
    >
      <div>
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            MCP server
          </h3>
          <InfoTooltip text="Lets MCP-compatible agents search, read, list, and follow links across the selected Forge through Moldavite's own validated note tools." />
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Connect Claude or another MCP client to Moldavite. The app binary runs as a local stdio
          server; no GUI or network service is started.
        </p>
      </div>

      <SetupSnippet
        label="Claude Code"
        value={cliCommand}
        disabled={!binaryPath}
        onCopy={() => void copy(cliCommand)}
      />
      <SetupSnippet
        label="Claude Desktop configuration"
        value={desktopJson}
        disabled={!binaryPath}
        onCopy={() => void copy(desktopJson)}
      />

      <div className="flex items-center justify-between gap-4 pt-1">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Allow agents to write notes
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Adds create, replace, and daily-note append tools. Read tools are always available.
          </p>
        </div>
        <Toggle
          enabled={writesEnabled}
          onChange={handleWritesToggle}
          ariaLabel="Allow agents to write notes"
        />
      </div>

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
    </div>
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
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <button
          type="button"
          onClick={onCopy}
          disabled={disabled}
          className="flex items-center gap-1 text-xs disabled:opacity-50"
          style={{ color: 'var(--accent-primary)' }}
          aria-label={`Copy ${label}`}
        >
          Copy
        </button>
      </div>
      <pre
        className="text-xs p-3 overflow-x-auto whitespace-pre-wrap break-all"
        style={{
          color: 'var(--text-secondary)',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {value}
      </pre>
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
    <div
      className="p-4 space-y-4"
      style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Semantic search
            </h3>
            <InfoTooltip text="Adds a by-meaning search mode to the sidebar search and a 'Related' list under each note, powered by a small AI model that runs entirely on your Mac." />
          </div>
        </div>
        <Toggle
          enabled={semantic.enabled}
          onChange={handleToggle}
          ariaLabel="Enable semantic search"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <label htmlFor="semantic-model" className="text-sm font-medium">
          Model
        </label>
        <select
          id="semantic-model"
          aria-label="Semantic search model"
          value={activeModel?.id ?? ''}
          onChange={(event) => handleModelChange(event.target.value)}
          disabled={isBuilding}
          className="input max-w-[19rem] disabled:opacity-50"
        >
          {semantic.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} — ~{model.downloadSizeMb} MB · {model.description}
            </option>
          ))}
        </select>
      </div>

      {/* Live status */}
      {semantic.enabled && (
        <div className="flex items-center gap-3 flex-wrap">
          <SemanticStatusLine />
          <button
            onClick={handleRebuild}
            disabled={isBuilding}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <RefreshCw
              aria-hidden="true"
              className={`w-4 h-4 ${isBuilding ? 'animate-spin' : ''}`}
            />
            {isBuilding ? 'Building…' : 'Rebuild index'}
          </button>
        </div>
      )}

      {/* Consent dialog — shown before anything is downloaded */}
      {confirmEnable && (
        <ConfirmDialog
          title="Enable semantic search?"
          message={`Downloads ${activeModel?.label ?? 'the selected model'}${activeModel ? ` (~${activeModel.downloadSizeMb} MB)` : ''} once from HuggingFace; afterwards everything runs fully offline — your notes never leave your Mac. Your notes are then indexed locally so you can search by meaning.`}
          confirmLabel="Download & enable"
          onConfirm={handleConfirmEnable}
          onCancel={() => setConfirmEnable(false)}
        />
      )}

      {pendingModel && (
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
    </div>
  );
}

function SemanticStatusLine() {
  const { state, progress, indexedCount, error } = useSemanticStore();

  if (state === 'downloading') {
    return (
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Downloading model…
      </span>
    );
  }
  if (state === 'indexing') {
    const detail =
      progress && progress.phase === 'indexing' && progress.total > 0
        ? ` ${progress.done}/${progress.total}`
        : '';
    return (
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Indexing notes…{detail}
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="text-xs" style={{ color: 'var(--error)' }} role="alert">
        {error ?? 'Semantic search hit an error'}
      </span>
    );
  }
  if (state === 'ready') {
    return (
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {indexedCount} {indexedCount === 1 ? 'note' : 'notes'} indexed — ready
      </span>
    );
  }
  return null;
}
