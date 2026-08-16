import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SettingsModal } from './SettingsModal';
import { TemplateEditorModal } from './TemplateEditorModal';

vi.mock('@/hooks/useTemplates', () => ({
  useTemplates: () => ({
    deleteExistingTemplate: vi.fn(),
    updateExistingTemplate: vi.fn(),
    saveNewTemplate: vi.fn(),
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/components/templates/SettingsTemplates', () => ({
  SettingsTemplates: () => null,
}));

vi.mock('./SettingsData', () => ({ SettingsData: () => null }));
vi.mock('./sections/AboutSection', () => ({ AboutSection: () => null }));
vi.mock('./sections/AgentsSection', () => ({ AgentsSection: () => null }));
vi.mock('./sections/AppearanceSection', () => ({ AppearanceSection: () => null }));
vi.mock('./sections/CalendarSection', () => ({ CalendarSection: () => null }));
vi.mock('./sections/EditorSection', () => ({ EditorSection: () => null }));
vi.mock('./sections/FeaturesSection', () => ({ FeaturesSection: () => null }));
vi.mock('./sections/GeneralSection', () => ({ GeneralSection: () => null }));
vi.mock('./sections/ImportSection', () => ({ ImportSection: () => null }));
vi.mock('./sections/LayoutSection', () => ({ LayoutSection: () => null }));
vi.mock('./sections/PluginsSection', () => ({ PluginsSection: () => null }));
vi.mock('./sections/SidebarSection', () => ({ SidebarSection: () => null }));

describe('nested modal Escape handling', () => {
  beforeEach(() => {
    useSettingsStore.setState({ isSettingsOpen: true, activeSettingsTab: 'general' });
  });

  it('cancels a confirmation without closing Settings', () => {
    const onCancel = vi.fn();
    render(
      <>
        <SettingsModal />
        <ConfirmDialog
          title="Uninstall plugin"
          message="Remove this plugin?"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </>
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });

  it('closes the template editor without closing Settings', () => {
    const onClose = vi.fn();
    render(
      <>
        <SettingsModal />
        <TemplateEditorModal isOpen onClose={onClose} />
      </>
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
  });
});
