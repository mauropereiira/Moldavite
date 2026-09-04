import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PluginPermissionSheet } from './PluginPermissionSheet';

const manifest = {
  name: 'Example Plugin',
  version: '1.0.0',
  author: 'Someone',
  description: 'Does something useful.',
};

describe('PluginPermissionSheet focus trap', () => {
  it('is a named, modal dialog and traps focus inside it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <PluginPermissionSheet
        manifest={manifest}
        permissions={['net.fetch']}
        mode="grant"
        onEnable={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Enable plugin?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const closeButton = screen.getByRole('button', { name: 'Close' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const enableButton = screen.getByRole('button', { name: 'Enable' });

    // Initial focus lands inside the dialog.
    await waitFor(() => expect(closeButton).toHaveFocus());

    // Tab from the last focusable element wraps back to the first.
    enableButton.focus();
    fireEvent.keyDown(enableButton, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    // Shift+Tab from the first focusable element wraps to the last.
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(enableButton).toHaveFocus();

    expect(cancelButton).toBeInTheDocument();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <PluginPermissionSheet
        manifest={manifest}
        permissions={['net.fetch']}
        mode="grant"
        onEnable={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a backdrop click but not on a click inside the dialog', () => {
    const onClose = vi.fn();
    render(
      <PluginPermissionSheet
        manifest={manifest}
        permissions={['net.fetch']}
        mode="grant"
        onEnable={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('dialog', { name: 'Enable plugin?' }));
    expect(onClose).not.toHaveBeenCalled();

    // The backdrop is the dialog's portal-mounted parent element.
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
