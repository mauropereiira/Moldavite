import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageForgesModal } from './ManageForgesModal';
import { useToastStore } from '@/stores';

const forge = vi.hoisted(() => ({
  deleteForge: vi.fn(async (_name: string) => undefined),
}));

vi.mock('@/stores', async () => {
  const actual = await vi.importActual<typeof import('@/stores')>('@/stores');
  return {
    ...actual,
    useForgeStore: () => ({
      forges: [
        { name: 'Default', path: '/f/Default', isActive: true, isSynced: false },
        { name: 'Work', path: '/f/Work', isActive: false, isSynced: false },
      ],
      forgesRoot: '/f',
      loadForges: vi.fn(async () => undefined),
      renameForge: vi.fn(),
      deleteForge: forge.deleteForge,
      setForgesRoot: vi.fn(),
      setSyncedForge: vi.fn(),
    }),
  };
});

function deleteButtons() {
  return screen.getAllByRole('button', { name: 'Delete' });
}

describe('ManageForgesModal', () => {
  beforeEach(() => {
    forge.deleteForge.mockClear();
    useToastStore.setState({ toasts: [] });
  });

  // WKWebView on iOS shows no window.confirm, so the delete did nothing there.
  it('confirms a delete in its own dialog', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<ManageForgesModal isOpen onClose={vi.fn()} />);

    fireEvent.click(deleteButtons()[1]);
    const dialog = screen.getByRole('dialog', { name: 'Delete the Forge "Work"?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Forge' }));

    expect(confirm).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(forge.deleteForge).toHaveBeenCalledWith('Work'));
  });

  it('says why the active Forge cannot be deleted instead of ignoring the tap', () => {
    render(<ManageForgesModal isOpen onClose={vi.fn()} />);

    fireEvent.click(deleteButtons()[0]);

    expect(forge.deleteForge).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'Switch to another Forge before deleting this one',
    });
  });

  it('closes with an ink Done, not an accent-filled one', () => {
    render(<ManageForgesModal isOpen onClose={vi.fn()} />);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.style.background).toBe('');
    expect(done.style.color).toBe('var(--text-primary)');
  });
});
