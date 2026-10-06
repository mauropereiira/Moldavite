import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { JACK_O_LANTERN_SMALL_SRC } from '@/lib/seasons';
import { SettingsModal } from './SettingsModal';

const platform = vi.hoisted(() => ({ mobile: true }));
vi.mock('@/lib/platform', () => ({ isMobilePlatform: () => platform.mobile }));

vi.mock('./SettingsData', () => ({ SettingsData: () => <div data-testid="data-section" /> }));
vi.mock('./sections/AboutSection', () => ({
  AboutSection: () => <div data-testid="about-section" />,
}));
vi.mock('./sections/AgentsSection', () => ({ AgentsSection: () => null }));
vi.mock('./sections/AppearanceSection', () => ({ AppearanceSection: () => null }));
vi.mock('./sections/CalendarSection', () => ({ CalendarSection: () => null }));
vi.mock('./sections/GeneralSection', () => ({
  GeneralSection: () => <div data-testid="general-section" />,
}));
vi.mock('./sections/LayoutSection', () => ({
  LayoutSection: () => <div data-testid="layout-section" />,
}));
vi.mock('./sections/PluginsSection', () => ({ PluginsSection: () => null }));
vi.mock('./sections/WritingSection', () => ({
  WritingSection: () => <div data-testid="writing-section" />,
}));

const list = () => screen.queryByRole('navigation', { name: 'Settings sections' });
const backButton = () => screen.queryByRole('button', { name: 'Back to settings' });
const closeButton = () => screen.getByRole('button', { name: 'Close settings' });
const search = () => screen.getByRole('searchbox', { name: 'Search settings' });

describe('Settings seasonal art', () => {
  it.each([true, false])(
    'shows a labelled pumpkin mask while touches are on (phone: %s)',
    (mobile) => {
      platform.mobile = mobile;
      useSettingsStore.setState({ isSettingsOpen: true, showSeasonalTouches: true });
      render(<SettingsModal />);

      const pumpkin = screen.getByRole('img', { name: 'Happy autumn' });
      expect(pumpkin).toHaveAttribute('title', 'Happy autumn');
      expect(pumpkin).not.toHaveAttribute('aria-hidden');
      expect(pumpkin.style.maskImage).toBe(`url("${JACK_O_LANTERN_SMALL_SRC}")`);
      expect(pumpkin.tagName).toBe('SPAN');
      expect(pumpkin.closest('nav')).not.toBeNull();

      act(() => useSettingsStore.setState({ showSeasonalTouches: false }));
      expect(screen.queryByRole('img', { name: 'Happy autumn' })).toBeNull();
    }
  );
});

describe('old tab ids', () => {
  // Plugins, deep links and persisted phone state can still name a tab that
  // was folded into another one.
  it.each([
    ['editor', 'writing', null],
    ['features', 'writing', 'linking'],
    ['sidebar', 'layout', 'index'],
    ['templates', 'writing', 'templates'],
    ['import', 'data', 'import'],
    ['plugins', 'plugins', null],
    ['nonsense', 'general', null],
  ] as const)('sends %s to %s', (old, tab, anchor) => {
    useSettingsStore.getState().setActiveSettingsTab(old as never);
    expect(useSettingsStore.getState().activeSettingsTab).toBe(tab);
    expect(useSettingsStore.getState().settingsAnchor).toBe(anchor);

    useSettingsStore.getState().setSettingsSection(old as never);
    expect(useSettingsStore.getState().settingsSection).toBe(tab);
  });

  it('renders the new home of an old id set straight on the store', () => {
    platform.mobile = false;
    useSettingsStore.setState({ isSettingsOpen: true, activeSettingsTab: 'sidebar' as never });
    render(<SettingsModal />);
    expect(screen.getByRole('heading', { level: 1, name: 'Layout' })).toBeInTheDocument();
    expect(screen.getByTestId('layout-section')).toBeInTheDocument();
  });
});

describe('SettingsModal on a phone', () => {
  beforeEach(() => {
    platform.mobile = true;
    // A remembered tab must not be where the page opens.
    useSettingsStore.setState({
      isSettingsOpen: true,
      activeSettingsTab: 'about',
      settingsSection: null,
    });
  });

  it('opens at the grouped section list, not the remembered tab', () => {
    render(<SettingsModal />);

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(list()).toBeInTheDocument();
    expect(screen.queryByTestId('about-section')).not.toBeInTheDocument();
    expect(backButton()).not.toBeInTheDocument();
    const basics = screen.getByRole('group', { name: 'Basics' });
    expect(
      within(basics)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['General', 'Appearance', 'Layout', 'Writing']);
    expect(screen.getByRole('group', { name: 'Your data' })).toHaveTextContent('DataAbout');
  });

  // The rail paints above the ground, but a pinned bar spanning the rail's
  // column does not; it used to show through there above the rail.
  it('covers the whole screen and sets its page beside the icon rail', () => {
    const { container } = render(<SettingsModal />);

    const page = container.firstElementChild as HTMLElement;
    expect(page.className).toContain('inset-0');
    expect(page.style.background).toBe('var(--bg-base)');
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.marginLeft).toBe('var(--rail-inset-left)');
    expect(dialog.style.marginRight).toBe('var(--rail-inset-right)');
    expect(dialog.className).not.toContain('settings-page');
    expect(dialog.className).not.toContain('modal-content-enter');
    expect(dialog.style.paddingTop).toBe('var(--safe-top)');
    expect(dialog.style.paddingBottom).toBe('var(--safe-bottom)');
  });

  // The page's ground and hairlines run to the screen edge; only the text
  // clears the landscape safe area on the edge the rail does not cover.
  it('insets its contents, not its rules, by the safe area without the rail', () => {
    render(<SettingsModal />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.style.paddingLeft).toBe('');
    expect(dialog.style.paddingRight).toBe('');
    const header = dialog.querySelector('header') as HTMLElement;
    expect(header.style.paddingLeft).toContain('var(--page-safe-left)');
    expect(header.style.paddingRight).toContain('var(--page-safe-right)');
    const row = screen.getByRole('button', { name: 'General' });
    expect(row.style.padding).toContain('var(--page-safe-left)');
    expect(row.style.padding).toContain('var(--page-safe-right)');

    fireEvent.click(row);
    const panel = screen.getByRole('region', { name: 'General' });
    expect(panel.style.padding).toContain('var(--page-safe-left)');
    expect(panel.style.padding).toContain('var(--page-safe-right)');
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

  it('leaves AI & Agents, Plugins and the Obsidian import off the phone', () => {
    render(<SettingsModal />);
    expect(screen.queryByRole('button', { name: /AI & Agents/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Plugins/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Data/ })).toBeInTheDocument();

    fireEvent.change(search(), { target: { value: 'obsidian' } });
    expect(screen.getByRole('status')).toHaveTextContent('No settings match "obsidian".');
  });

  it('lists Calendar on the phone, where Apple and Google both connect', () => {
    render(<SettingsModal />);
    expect(screen.getByRole('button', { name: /^Calendar/ })).toBeInTheDocument();
  });

  it('searches and opens the section holding the result', () => {
    render(<SettingsModal />);

    fireEvent.change(search(), { target: { value: 'spell' } });
    fireEvent.click(screen.getByRole('button', { name: /^Spell check/ }));

    expect(useSettingsStore.getState().settingsSection).toBe('writing');
    expect(screen.getByTestId('writing-section')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Writing' })).toBeInTheDocument();
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

  it('is a full page with grouped navigation, opening on the remembered tab', () => {
    render(<SettingsModal />);

    const nav = list() as HTMLElement;
    expect(within(nav).getByRole('group', { name: 'Connections' })).toHaveTextContent(
      'CalendarAI & AgentsPlugins'
    );
    expect(within(nav).getByRole('button', { name: 'About' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('heading', { level: 1, name: 'About' })).toBeInTheDocument();
    expect(screen.getByTestId('about-section')).toBeInTheDocument();
    expect(screen.getByRole('dialog').className).toContain('settings-page');
    expect(backButton()).not.toBeInTheDocument();
  });

  it('switches tabs from the navigation', () => {
    render(<SettingsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Writing' }));

    expect(useSettingsStore.getState().activeSettingsTab).toBe('writing');
    expect(screen.getByRole('heading', { level: 1, name: 'Writing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About' })).not.toHaveAttribute('aria-current');
  });

  // The "agent-friendly by design" block contradicted "make this Forge
  // agent-ready" right under it; its point is now the title's (i).
  it('explains AI & Agents in an (i) by the title, not a block above the controls', () => {
    useSettingsStore.setState({ activeSettingsTab: 'agents' });
    render(<SettingsModal />);

    expect(screen.queryByText(/agent-friendly by design/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About AI & Agents' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/plain Markdown files/);
  });

  it('searches every tab, and Enter opens the first result where it lives', () => {
    render(<SettingsModal />);

    fireEvent.change(search(), { target: { value: 'icloud' } });
    expect(screen.queryByTestId('about-section')).not.toBeInTheDocument();
    const result = screen.getByRole('button', { name: /^Synced Forge \(iCloud\)/ });
    expect(result).toHaveTextContent('General › Forge');

    fireEvent.keyDown(search(), { key: 'Enter' });

    expect(useSettingsStore.getState().activeSettingsTab).toBe('general');
    expect(search()).toHaveValue('');
    expect(screen.getByTestId('general-section')).toBeInTheDocument();
  });

  it('says so when nothing matches', () => {
    render(<SettingsModal />);
    fireEvent.change(search(), { target: { value: 'xyzzy' } });
    expect(screen.getByRole('status')).toHaveTextContent('No settings match "xyzzy".');
  });

  it('clears the search on Escape before Escape closes Settings', () => {
    render(<SettingsModal />);
    fireEvent.change(search(), { target: { value: 'tags' } });

    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(search()).toHaveValue('');
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);

    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });

  it('moves through results with the arrow keys', () => {
    render(<SettingsModal />);
    fireEvent.change(search(), { target: { value: 'backlinks' } });

    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    const results = screen.getAllByRole('button', { name: /Backlinks/ });
    expect(document.activeElement).toBe(results[0]);
    fireEvent.keyDown(results[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(results[1]);
  });

  it('closes from its ×', () => {
    render(<SettingsModal />);
    fireEvent.click(closeButton());
    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
  });
});
