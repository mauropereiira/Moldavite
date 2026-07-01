import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WhatsNewModal } from './WhatsNewModal';
import { useWhatsNewStore } from '@/stores/whatsNewStore';

// getVersion is async; resolve to a fixed version so the launch effect is deterministic.
vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('1.4.0') }));

describe('WhatsNewModal', () => {
  beforeEach(() => {
    useWhatsNewStore.setState({ lastSeenVersion: '1.4.0', isOpen: false, entry: null });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<WhatsNewModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the version, groups, and bullets when opened', () => {
    render(<WhatsNewModal />);
    act(() => {
      useWhatsNewStore.getState().open({
        version: '1.4.0',
        date: '2026-06-30',
        groups: [{ title: 'Fixed', items: ['Info tooltips no longer clipped'] }],
      });
    });
    expect(screen.getByText(/what's new/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.4\.0/)).toBeInTheDocument();
    expect(screen.getByText('Fixed')).toBeInTheDocument();
    expect(screen.getByText('Info tooltips no longer clipped')).toBeInTheDocument();
  });

  it('closes when the dismiss button is clicked', () => {
    render(<WhatsNewModal />);
    act(() => {
      useWhatsNewStore
        .getState()
        .open({ version: '1.4.0', date: null, groups: [{ title: 'Added', items: ['x'] }] });
    });
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(useWhatsNewStore.getState().isOpen).toBe(false);
  });
});
