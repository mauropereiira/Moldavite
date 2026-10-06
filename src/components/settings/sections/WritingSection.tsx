/** WritingSection: typing aids, tags, and the templates folded below. */

import { useSettingsStore } from '@/stores';
import { isMobilePlatform } from '@/lib/platform';
import { useTemplates } from '@/hooks/useTemplates';
import { SettingsTemplates } from '@/components/templates/SettingsTemplates';
import { Group, ToggleRow } from '../common';

export function WritingSection() {
  const settings = useSettingsStore();
  const { deleteExistingTemplate, updateExistingTemplate } = useTemplates();

  return (
    <div className="settings-tab">
      <Group id="typing">
        {/* A phone has its own formatting row above the keyboard. */}
        {!isMobilePlatform() && (
          <ToggleRow
            id="writing-toolbar"
            value={settings.showWritingToolbar}
            onChange={settings.setShowWritingToolbar}
          />
        )}
        <ToggleRow id="spell-check" value={settings.spellCheck} onChange={settings.setSpellCheck} />
        <ToggleRow
          id="auto-capitalize"
          value={settings.autoCapitalize}
          onChange={settings.setAutoCapitalize}
        />
        <ToggleRow
          id="word-count"
          value={settings.showWordCount}
          onChange={settings.setShowWordCount}
        />
      </Group>

      <Group id="linking">
        <ToggleRow id="tags" value={settings.tagsEnabled} onChange={settings.setTagsEnabled} />
      </Group>

      <Group id="templates">
        <div data-setting="template-list">
          <SettingsTemplates
            onDeleteTemplate={async (id) => {
              await deleteExistingTemplate(id);
            }}
            onUpdateTemplate={async (id, name, description, icon, content) => {
              await updateExistingTemplate(id, { name, description, icon, content });
            }}
          />
        </div>
      </Group>
    </div>
  );
}
