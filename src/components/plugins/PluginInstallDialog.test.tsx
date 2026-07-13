/** The website route must stop at a permission-visible confirmation. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommunityPlugin } from '@/lib/plugins/registry';
import { PluginInstallDialog } from './PluginInstallDialog';

const plugin: CommunityPlugin = {
  id: 'publisher',
  name: 'Publisher',
  version: '1.0.0',
  description: 'Publishes the active note.',
  author: 'Moldavite',
  apiVersion: 2,
  permissions: ['notes.read', 'net.fetch'],
  allowedHosts: ['api.example.com'],
  files: {
    'manifest.json': { sha256: 'a'.repeat(64) },
    'plugin.js': { sha256: 'b'.repeat(64) },
  },
};

describe('PluginInstallDialog', () => {
  it('shows permissions and waits for explicit install confirmation', () => {
    const onInstall = vi.fn();
    render(<PluginInstallDialog plugin={plugin} onInstall={onInstall} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Install community plugin?' })).toBeInTheDocument();
    expect(screen.getByText('List notes and read unlocked Markdown content')).toBeInTheDocument();
    expect(screen.getByText('api.example.com')).toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledOnce();
  });
});
