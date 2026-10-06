import { useEditorState, type Editor } from '@tiptap/react';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { BLOCK_TYPES, TEXT_BLOCK, currentBlockType } from './blockTypes';

/** "Text ▾" at the start of a toolbar: what the current block is, and what it can become. */
export function BlockTypeMenu({ editor }: { editor: Editor }) {
  const currentId = useEditorState({
    editor,
    selector: ({ editor: state }) => currentBlockType(state).id,
  });
  const current = [TEXT_BLOCK, ...BLOCK_TYPES].find((type) => type.id === currentId) ?? TEXT_BLOCK;
  return (
    <Dropdown
      trigger={
        <button
          type="button"
          className="toolbar-button block-type-trigger"
          title="Turn into"
          aria-label={`Block type: ${current.label}`}
        >
          {current.label}
          <span aria-hidden="true" className="block-type-caret" />
        </button>
      }
    >
      {[TEXT_BLOCK, ...BLOCK_TYPES].map((type) => (
        <DropdownItem key={type.id} onClick={() => type.apply(editor)}>
          <span aria-current={type.id === current.id || undefined}>{type.label}</span>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
