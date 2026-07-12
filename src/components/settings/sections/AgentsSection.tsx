/**
 * AgentsSection — "AI & Agents": make the active Forge agent-ready.
 *
 * A Forge is already plain Markdown on disk, so AI agents (Claude Code, etc.)
 * can work with it directly. This section writes an `AGENTS.md` describing
 * the vault's conventions plus a `.gitignore` for app-managed directories,
 * via the whitelisted `write_forge_root_file` backend command.
 */

import { useState, useEffect, useCallback } from 'react';
import { Bot, FileCheck2, FileX2, Sparkles } from 'lucide-react';
import { useForgeStore } from '@/stores/forgeStore';
import { useToast } from '@/hooks/useToast';
import { ConfirmDialog } from '@/components/ui';
import { buildAgentsMd, GITIGNORE_CONTENT, readForgeRootFile, writeForgeRootFile } from '@/lib';
import { InfoTooltip } from '../common';

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
