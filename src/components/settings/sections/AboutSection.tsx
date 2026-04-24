/**
 * AboutSection — App info, software updates, and keyboard shortcuts.
 */

import { useState, useEffect } from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useUpdateStore } from '@/stores';
import { ShortcutRow } from '../common';

function SoftwareUpdatesSection() {
  const { available, version, isChecking, lastChecked, error, checkForUpdate, installUpdate, downloading, progress } = useUpdateStore();

  return (
    <div className="p-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
      <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
        Software Updates
      </h4>

      <div className="space-y-3">
        {/* Update status */}
        {available ? (
          <div className="flex items-center gap-2 p-3" style={{ backgroundColor: 'var(--accent-subtle)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-color)' }}>
            <Download className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent-color)' }} />
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Update Available: v{version}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                A new version is ready to install
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3" style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)' }}>
            <Download className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {isChecking ? 'Checking for updates...' : 'You\'re up to date'}
              </p>
              {lastChecked && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Last checked: {lastChecked.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="text-xs px-3" style={{ color: 'var(--text-error, #ef4444)' }}>{error}</p>
        )}

        {/* Progress bar when downloading */}
        {downloading && (
          <div className="px-3">
            <div className="h-1.5 rounded overflow-hidden" style={{ backgroundColor: 'var(--bg-inset)' }}>
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${progress}%`, backgroundColor: 'var(--accent-color)' }}
              />
            </div>
            <p className="text-xs mt-1 text-center" style={{ color: 'var(--text-tertiary)' }}>
              {progress}%
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {available ? (
            <button
              onClick={installUpdate}
              disabled={downloading}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors text-white"
              style={{ backgroundColor: 'var(--accent-color)', borderRadius: 'var(--radius-sm)', opacity: downloading ? 0.7 : 1 }}
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Installing...' : 'Install Update'}
            </button>
          ) : (
            <button
              onClick={checkForUpdate}
              disabled={isChecking}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', opacity: isChecking ? 0.7 : 1 }}
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              {isChecking ? 'Checking...' : 'Check for Updates'}
            </button>
          )}
        </div>

        {/* GitHub link */}
        <button
          onClick={() => shellOpen('https://github.com/mauropereiira/Moldavite/releases')}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <ExternalLink className="w-3 h-3" />
          View releases on GitHub
        </button>
      </div>
    </div>
  );
}

export function AboutSection() {
  const [appVersion, setAppVersion] = useState<string>('');

  // Fetch app version on mount
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.0.0'));
  }, []);

  return (
    <div className="space-y-6">
      {/* App Info + Update Section */}
      <div className="flex items-start gap-4 p-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        {/* Logo */}
        <img
          src="/logo.png"
          alt="Moldavite Logo"
          className="h-16 w-16 flex-shrink-0"
          style={{ backgroundColor: 'transparent', borderRadius: 'var(--radius-md)' }}
        />

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Moldavite
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Version {appVersion || '...'}
          </p>
        </div>
      </div>

      {/* Update Status */}
      <SoftwareUpdatesSection />

      {/* Keyboard Shortcuts */}
      <div className="p-4" style={{ backgroundColor: 'var(--bg-panel)', borderRadius: 'var(--radius-md)' }}>
        <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          Keyboard Shortcuts
        </h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <ShortcutRow keys={['⌘', ',']} description="Settings" />
          <ShortcutRow keys={['⌘', 'T']} description="Template" />
          <ShortcutRow keys={['⌘', 'B']} description="Bold" />
          <ShortcutRow keys={['⌘', 'I']} description="Italic" />
          <ShortcutRow keys={['⌘', 'U']} description="Underline" />
          <ShortcutRow keys={['⌘', 'K']} description="Link" />
          <ShortcutRow keys={['⌘', 'Z']} description="Undo" />
          <ShortcutRow keys={['⌘', '⇧', 'Z']} description="Redo" />
        </div>
      </div>

    </div>
  );
}
