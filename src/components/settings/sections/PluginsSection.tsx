/**
 * PluginsSection — Promotes the open-source plugin model and invites
 * community contributions. The plugin loader is design-only (see
 * `docs/PLUGINS_DESIGN.md`); this section is informational + CTA.
 */

import { Puzzle, ExternalLink, Github, FileCode, Bug } from 'lucide-react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

const DESIGN_DOC_URL = 'https://github.com/mauropereiira/Moldavite/blob/main/docs/PLUGINS_DESIGN.md';
const NEW_ISSUE_URL = 'https://github.com/mauropereiira/Moldavite/issues/new';
const REPO_URL = 'https://github.com/mauropereiira/Moldavite';

const STARTER_IDEAS = [
  'Zoom helper',
  'Google Meet helper',
  'Web clipper',
  'Custom export formats',
  'Publish to blog',
];

export function PluginsSection() {
  const openExternal = (url: string) => {
    shellOpen(url).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="flex-shrink-0 p-2"
          style={{ backgroundColor: 'var(--accent-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-primary)' }}
        >
          <Puzzle aria-hidden="true" className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Plugins
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Extend Moldavite with integrations — Zoom, Google Meet, custom workflows, or your own ideas.
          </p>
        </div>
      </div>

      {/* Status banner */}
      <div
        className="p-4"
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-default)',
          borderLeft: '3px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Plugin system: design phase
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          We&apos;re building toward a plugin model where community-made integrations live in your Forge under <code style={{ backgroundColor: 'var(--bg-inset)', padding: '1px 4px', borderRadius: 'var(--radius-sm)' }}>.plugins/</code>.
        </p>
        <button
          type="button"
          onClick={() => openExternal(DESIGN_DOC_URL)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          <FileCode aria-hidden="true" className="w-3.5 h-3.5" />
          Read the design doc
          <ExternalLink aria-hidden="true" className="w-3 h-3" />
        </button>
      </div>

      {/* Empty state */}
      <div
        className="p-6 text-center"
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px dashed var(--border-default)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No plugins installed yet.
        </p>
      </div>

      {/* Build your own */}
      <div
        className="p-4"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <h4 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Build your own integration
        </h4>
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          Moldavite is open source and we&apos;d love your help. Read the design spec, then ship a plugin or open an issue with your idea.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => openExternal(DESIGN_DOC_URL)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
            aria-label="View the design spec on GitHub"
          >
            <FileCode aria-hidden="true" className="w-4 h-4" />
            View the design spec
          </button>
          <button
            type="button"
            onClick={() => openExternal(NEW_ISSUE_URL)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
            }}
            aria-label="Open an issue on GitHub"
          >
            <Bug aria-hidden="true" className="w-4 h-4" />
            Open an issue
          </button>
        </div>

        <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
          Starter ideas:
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {STARTER_IDEAS.map((idea) => (
            <li
              key={idea}
              className="text-xs px-2 py-0.5"
              style={{
                backgroundColor: 'var(--bg-inset)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              {idea}
            </li>
          ))}
        </ul>
      </div>

      {/* Open source footer */}
      <div
        className="p-4 flex items-center justify-between gap-3 flex-wrap"
        style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Moldavite is MIT-licensed. Pull requests welcome.
        </p>
        <button
          type="button"
          onClick={() => openExternal(REPO_URL)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Open Moldavite repo on GitHub"
        >
          <Github aria-hidden="true" className="w-3.5 h-3.5" />
          View on GitHub
          <ExternalLink aria-hidden="true" className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
