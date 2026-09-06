import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { SettingsModal } from './SettingsModal';

const platform = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

vi.mock('@/hooks/useTemplates', () => ({
  useTemplates: () => ({
    deleteExistingTemplate: vi.fn(),
    updateExistingTemplate: vi.fn(),
    saveNewTemplate: vi.fn(),
  }),
}));

vi.mock('@/components/templates/SettingsTemplates', () => ({
  SettingsTemplates: () => null,
}));

vi.mock('./SettingsData', () => ({ SettingsData: () => null }));
vi.mock('./sections/AboutSection', () => ({
  AboutSection: () => <div data-testid="about-section" />,
}));
vi.mock('./sections/AgentsSection', () => ({ AgentsSection: () => null }));
vi.mock('./sections/AppearanceSection', () => ({ AppearanceSection: () => null }));
vi.mock('./sections/CalendarSection', () => ({ CalendarSection: () => null }));
vi.mock('./sections/EditorSection', () => ({ EditorSection: () => null }));
vi.mock('./sections/FeaturesSection', () => ({ FeaturesSection: () => null }));
vi.mock('./sections/GeneralSection', () => ({
  GeneralSection: () => <div data-testid="general-section" />,
}));
vi.mock('./sections/ImportSection', () => ({ ImportSection: () => null }));
vi.mock('./sections/LayoutSection', () => ({ LayoutSection: () => null }));
vi.mock('./sections/PluginsSection', () => ({ PluginsSection: () => null }));
vi.mock('./sections/SidebarSection', () => ({ SidebarSection: () => null }));

const list = () => screen.queryByRole('navigation', { name: 'Settings sections' });
const backButton = () => screen.queryByRole('button', { name: 'Back to settings' });
const closeButton = () => screen.getByRole('button', { name: 'Close settings' });

describe('SettingsModal on a phone', () => {
  beforeEach(() => {
    platform.mobile = true;
    // A remembered tab must not be where the page opens.
    useSettingsStore.setState({ isSettingsOpen: true, activeSettingsTab: 'about' });
  });

  it('opens at the section list, not the remembered tab', () => {
    render(<SettingsModal />);

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(list()).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('about-section')).not.toBeInTheDocument();
    expect(backButton()).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(General|About)$/ })).toHaveLength(2);
  });

  it('fills the content area beside the icon rail instead of centring a dialog', () => {
    const { container } = render(<SettingsModal />);

    const page = container.firstElementChild as HTMLElement;
    expect(page.style.left).toBe('var(--rail-width)');
    expect(page.style.right).toBe('0px');
    expect(page.className).not.toContain('inset-0');
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).not.toContain('max-w-3xl');
    expect(dialog.className).not.toContain('modal-content-enter');
    expect(dialog.style.paddingTop).toBe('var(--safe-top)');
    expect(dialog.style.paddingBottom).toBe('var(--safe-bottom)');
  });

  it('opens a section from its row and returns to the list from the back control', () => {
    render(<SettingsModal />);

    fireEvent.click(screen.getByRole('button', { name: 'General' }));

    expect(screen.getByTestId('general-section')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'General' })).toBeInTheDocument();
    expect(list()).not.toBeInTheDocument();
    expect(useSettingsStore.getState().activeSettingsTab).toBe('general');

    fireEvent.click(backButton() as HTMLElement);

    expect(list()).toBeInTheDocument();
    expect(screen.queryByTestId('general-section')).not.toBeInTheDocument();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });

  it('leaves AI & Agents and Import off the phone list', () => {
    render(<SettingsModal />);
    expect(screen.queryByRole('button', { name: /AI & Agents/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Data/ })).toBeInTheDocument();
  });

  it('closes from the list', () => {
    render(<SettingsModal />);

    fireEvent.click(closeButton());

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('closes from inside a section', () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'General' }));

    fireEvent.click(closeButton());

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('closes on Escape from inside a section', () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'General' }));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('starts at the list again after closing and reopening', () => {
    const { rerender } = render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'General' }));

    // Through the setter: closing is what forgets the section.
    useSettingsStore.getState().setIsSettingsOpen(false);
    rerender(<SettingsModal />);
    useSettingsStore.getState().setIsSettingsOpen(true);
    rerender(<SettingsModal />);

    expect(list()).toBeInTheDocument();
    expect(screen.queryByTestId('general-section')).not.toBeInTheDocument();
  });
});

describe('SettingsModal on the desktop', () => {
  beforeEach(() => {
    platform.mobile = false;
    useSettingsStore.setState({ isSettingsOpen: true, activeSettingsTab: 'about' });
  });

  it('keeps the tab dialog and opens on the remembered tab', () => {
    render(<SettingsModal />);

    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('about-section')).toBeInTheDocument();
    expect(list()).not.toBeInTheDocument();
    expect(backButton()).not.toBeInTheDocument();
    expect(screen.getByRole('dialog').className).toContain('max-w-3xl');
  });
});
