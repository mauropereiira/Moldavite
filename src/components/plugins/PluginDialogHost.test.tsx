import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPluginPrompt, cancelPluginDialog } from '@/lib/plugins/dialogs';
import { usePluginStore } from '@/stores/pluginStore';
import { useToastStore } from '@/stores/toastStore';

vi.mock('@/lib/plugins/host', () => ({
  unloadPlugin: vi.fn((id: string) => cancelPluginDialog(id)),
}));

import { unloadPlugin } from '@/lib/plugins/host';
import { PluginDialogHost } from './PluginDialogHost';

describe('PluginDialogHost', () => {
  beforeEach(() => {
    usePluginStore.setState({ grants: {} });
    usePluginStore.getState().grant('loopy', '1.0.0', 'hash');
    useToastStore.setState({ toasts: [] });
  });

  it('lets the user turn off a plugin from inside its own prompt', async () => {
    render(<PluginDialogHost />);
    let answer: Promise<Record<string, string> | null> | null = null;
    act(() => {
      answer = requestPluginPrompt('loopy', 'Loopy', {
        title: 'Enter your password',
        fields: [{ name: 'password', label: 'Password', type: 'password' }],
      });
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('Loopy');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn off plugin' }));
    });

    expect(unloadPlugin).toHaveBeenCalledWith('loopy');
    expect(usePluginStore.getState().grants.loopy?.enabled).toBe(false);
    await expect(answer).resolves.toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts[0]?.message).toContain('Turned off Loopy');
  });
});
