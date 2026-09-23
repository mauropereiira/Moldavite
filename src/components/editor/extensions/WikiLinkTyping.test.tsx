import { fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '@/types';
import { WikiLink } from './WikiLink';
import { wikiLinkSuggestionAllowed } from './WikiLinkSuggestion';
import { WikiLinkSuggestionList, wikiLinkSuggestionItems } from './WikiLinkSuggestionList';

const note = (name: string): NoteFile => ({
  name,
  path: `notes/${name}`,
  isDaily: false,
  isWeekly: false,
  isLocked: false,
});

let editor: Editor;
afterEach(() => editor?.destroy());

function typeInto(text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (handle) =>
      handle(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to))
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

describe('typing a wiki link in full', () => {
  function setup(existing: string[] = []) {
    editor = new Editor({
      extensions: [
        StarterKit,
        WikiLink.configure({ noteExists: (target) => existing.includes(target) }),
      ],
      content: '<p></p>',
    });
    editor.commands.focus('end');
  }

  it('turns [[Name]] into a link as the closing bracket is typed', () => {
    setup();
    typeInto('See [[Project plan]] now');
    const link = editor.view.dom.querySelector('wiki-link');
    expect(link?.getAttribute('data-target')).toBe('project-plan.md');
    expect(link?.getAttribute('data-label')).toBe('Project plan');
    expect(link).toHaveClass('wiki-link-missing');
    expect(editor.getText()).toBe('See [[Project plan]] now');
  });

  it('marks a link to a note that exists as existing, and keeps an alias target', () => {
    setup(['project-plan.md']);
    typeInto('[[the plan|Project plan]]');
    const link = editor.view.dom.querySelector('wiki-link');
    expect(link).toHaveClass('wiki-link-exists');
    expect(link?.getAttribute('data-raw-target')).toBe('Project plan');
    expect(editor.getText()).toBe('[[the plan|Project plan]]');
  });
});

describe('the [[ suggestion', () => {
  it('ends once the link is closed with ]]', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p>[[Project plan]] and</p>' });
    const allowed = (to: number) =>
      wikiLinkSuggestionAllowed({
        editor,
        state: editor.state,
        range: { from: 1, to },
        isActive: true,
      });
    expect(allowed(9)).toBe(true);
    expect(allowed(editor.state.doc.content.size - 1)).toBe(false);
  });

  it('offers to create a note no note is named after, below the matches', () => {
    const notes = [note('Project plan.md'), note('Projects.md')];
    expect(wikiLinkSuggestionItems(notes, 'proj')).toEqual([
      { note: notes[0] },
      { note: notes[1] },
      { create: 'proj' },
    ]);
    expect(wikiLinkSuggestionItems(notes, 'project plan')).toEqual([{ note: notes[0] }]);
    expect(wikiLinkSuggestionItems(notes, '')).toEqual([{ note: notes[0] }, { note: notes[1] }]);
    expect(wikiLinkSuggestionItems(notes, 'Plan]')).toEqual([]);
  });

  it('shows the create row as something to tap', () => {
    const command = vi.fn();
    render(<WikiLinkSuggestionList items={[{ create: 'Fix b' }]} command={command} />);
    fireEvent.click(screen.getByRole('button', { name: /Create “Fix b”/ }));
    expect(command).toHaveBeenCalledWith({ create: 'Fix b' });
    expect(screen.queryByText('No notes found')).toBeNull();
  });
});
