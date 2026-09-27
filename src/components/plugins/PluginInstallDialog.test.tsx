/** Every install route must stop at a permission-visible confirmation. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PluginInstallDialog, type PluginInstallDetails } from './PluginInstallDialog';

const plugin: PluginInstallDetails = {
  id: 'publisher',
  name: 'Publisher',
  version: '1.1.0',
  description: 'Publishes the active note.',
  author: 'Moldavite',
  permissions: ['notes.read', 'net.fetch'],
  allowedHosts: ['api.example.com'],
};

describe('PluginInstallDialog', () => {
  it('shows permissions and waits for explicit install confirmation', () => {
    const onInstall = vi.fn();
    render(
      <PluginInstallDialog
        plugin={plugin}
        source="community"
        onInstall={onInstall}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Install community plugin?' })).toBeInTheDocument();
    expect(screen.getByText('List notes and read unlocked Markdown content')).toBeInTheDocument();
    expect(screen.getByText('api.example.com')).toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it('marks what an update newly asks for and what it no longer needs', () => {
    render(
      <PluginInstallDialog
        plugin={plugin}
        source="community"
        installed={{ version: '1.0.0', permissions: ['notes.read', 'secrets'], allowedHosts: [] }}
        onInstall={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Update Publisher?' })).toBeInTheDocument();
    const fetchItem = screen.getByText('Make HTTPS requests through Moldavite').closest('li');
    expect(fetchItem).toHaveTextContent('New');
    const readItem = screen
      .getByText('List notes and read unlocked Markdown content')
      .closest('li');
    expect(readItem).not.toHaveTextContent('New');
    expect(screen.getByText('api.example.com').closest('li')).toHaveTextContent('New');
    expect(screen.getByText(/No longer asks for/)).toHaveTextContent('password store');
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('warns that a package from a file was not reviewed and shows its code hash', () => {
    render(
      <PluginInstallDialog
        plugin={{
          ...plugin,
          codeSha256: 'c'.repeat(64),
          commands: [{ id: 'publish', label: 'Publish note' }],
        }}
        source="file"
        installed={{ version: '1.1.0', permissions: [], allowedHosts: [] }}
        onInstall={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/not the reviewed community directory/)).toBeInTheDocument();
    expect(screen.getByText('c'.repeat(64))).toBeInTheDocument();
    expect(screen.getByText('Publish note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
  });
});
