/** Install-time and persistent plugin information dialog rendering tests. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PluginAboutDialog } from './PluginAboutDialog';

describe('PluginAboutDialog', () => {
  it('renders manifest identity, commands, instructions, and permissions', () => {
    const onClose = vi.fn();
    render(
      <PluginAboutDialog
        manifest={{
          id: 'moldavite-wordpress',
          name: 'Publish to WordPress',
          version: '1.0.0',
          author: 'Moldavite',
          description: 'Publishes the active note as a draft.',
          apiVersion: 2,
          commands: [
            { id: 'configure-wordpress', label: 'Configure WordPress publishing' },
            { id: 'publish-wordpress', label: 'Publish note to WordPress…' },
          ],
          instructions: ['Press `Cmd+P` and run **Configure WordPress publishing** first.'],
          permissions: ['editor', 'net.fetch', 'secrets'],
          allowedHosts: ['public-api.wordpress.com'],
        }}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog', { name: 'About this plugin' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /publish to wordpress/i })).toBeInTheDocument();
    expect(screen.getByText('Publishes the active note as a draft.')).toBeInTheDocument();
    expect(screen.getAllByText('Configure WordPress publishing')).toHaveLength(2);
    expect(screen.getByText('Cmd+P')).toBeInTheDocument();
    expect(screen.getByText(/public-api\.wordpress\.com/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('auto-generates a start flow and uses runtime commands for a legacy manifest', () => {
    render(
      <PluginAboutDialog
        manifest={{
          id: 'legacy-plugin',
          name: 'Legacy Plugin',
          version: '1.0.0',
          description: 'Does something useful.',
          apiVersion: 1,
        }}
        registeredCommands={[{ id: 'legacy-plugin:run', label: 'Run legacy action' }]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Does something useful.')).toBeInTheDocument();
    expect(screen.getByText('Run legacy action')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === 'LI' && element.textContent?.includes('choose Run legacy action')
        )
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/No additional capabilities declared/i)).toBeInTheDocument();
  });
});
