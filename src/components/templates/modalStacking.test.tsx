import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EditTemplateModal } from './EditTemplateModal';
import { TemplateEditorModal } from '@/components/settings/TemplateEditorModal';
import type { Template } from '@/types/template';

// These modals are portaled to document.body and opened from inside the
// Settings modal, whose backdrop sits at z-[9999] (SettingsModal.tsx).
// They must stack above it or they render invisibly behind Settings —
// the convention for modals-over-settings is z-[10000] (PluginPermissionSheet).
const SETTINGS_MODAL_Z = 9999;

function dialogZIndex(): number {
  const dialog = document.body.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  const match = (dialog as HTMLElement).className.match(/z-\[(\d+)\]/);
  if (!match) throw new Error('dialog has no bracketed z-index class');
  return Number(match[1]);
}

const customTemplate: Template = {
  id: 'custom-1',
  name: 'My Template',
  description: '',
  icon: 'blank',
  content: '<p>hi</p>',
  isDefault: false,
};

describe('template modal stacking above Settings', () => {
  it('EditTemplateModal (custom template) stacks above the Settings modal', () => {
    render(
      <EditTemplateModal
        isOpen
        onClose={() => {}}
        template={customTemplate}
        onSave={async () => {}}
      />
    );
    expect(dialogZIndex()).toBeGreaterThan(SETTINGS_MODAL_Z);
  });

  it('EditTemplateModal (default template notice) stacks above the Settings modal', () => {
    render(
      <EditTemplateModal
        isOpen
        onClose={() => {}}
        template={{ ...customTemplate, isDefault: true }}
        onSave={async () => {}}
      />
    );
    expect(dialogZIndex()).toBeGreaterThan(SETTINGS_MODAL_Z);
  });

  it('TemplateEditorModal (new template) stacks above the Settings modal', () => {
    render(<TemplateEditorModal isOpen onClose={() => {}} />);
    expect(dialogZIndex()).toBeGreaterThan(SETTINGS_MODAL_Z);
  });
});
