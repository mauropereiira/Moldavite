/**
 * Every autosave rewrites the whole note from the editor, so a note in the
 * app's own Markdown must come back from load, TipTap and save byte for byte,
 * or an edit anywhere in it changes lines the user never touched.
 */

import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions } from '@/components/editor/noteExtensions';
import { htmlToMarkdown, noteContentToEditorHtml } from './fileSystem';

function save(markdown: string): string {
  const editor = new Editor({
    extensions: createNoteExtensions(),
    content: noteContentToEditorHtml(markdown),
  });
  try {
    return htmlToMarkdown(editor.getHTML());
  } finally {
    editor.destroy();
  }
}

const NOTES: Record<string, string> = {
  'a daily note':
    '## Tasks\n\n- [ ] Reply to [[Alice]] about the launch\n- [x] Ship the release\n  - [ ] Write the notes\n\n## Notes\n\nMet with **Bob** and *Carol*. See [[Project Plan|the plan]] and #work.\n\n> Remember: ship small.',
  'a shell script':
    '# Deploy script\n\n```bash\n#!/usr/bin/env bash\nset -euo pipefail\nif [[ -f "$file" ]]; then\n  echo "found [[$file]]"\nfi\n```\n\nRun it with `./deploy.sh [[ -n $X ]]`.',
  'an Obsidian note':
    '# Reading list\n\nLinked from [[Index]] and [[Books/2026|this year]].\n\n| Title | Status |\n| --- | --- |\n| [[Dune\\|Dune (1965)]] | done |\n| `[[not a link]]` | todo |\n\n- [ ] Finish [[Foundation]]\n- [x] Start [[Hyperion]]',
  'an aligned table':
    '| Name | Qty | Price |\n| :--- | :---: | ---: |\n| apple | 2 | 1.50 |\n| pear | 10 | 0.25 |',
  headings: '# One\n\n## Two\n\n### Three\n\nText under three.',
  'code in several languages':
    '```ts\nconst re = /\\[\\[(.+?)\\]\\]/g;\nconst x = a[[0]];\n```\n\n```python\nm = [[1, 2], [3, 4]]\n```',
  'a rule': 'Above\n\n---\n\nBelow',
  'inline marks': 'Mix of **bold**, *italic*, <u>underline</u>, <mark>highlight</mark> and `code`.',
  'centered text': '<p style="text-align: center">Centered text</p>\n\nNormal text',
  'an image': '<img src="images/photo.png" alt="A photo" width="320" data-alignment="center">',
  'nested tasks': '- [ ] parent\n  - [x] child one\n  - [ ] child two\n- [ ] sibling',
  'a hard break': 'line one  \nline two',
  'code spans beside links': 'Use ``a ` b`` and `[[x]]` and [[Real]].',
  'a fence inside a longer fence': '````md\n```\n[[inner]]\n```\n````',
  tags: 'Tagged #project and #area/sub in text.',
  unicode: 'Café ünïcode [[Ålias ÉÈ]] 日本語 [[日本]] emoji 🎉',
};

describe('a note saved without edits', () => {
  it.each(Object.entries(NOTES))('keeps %s byte for byte', (_name, markdown) => {
    expect(save(markdown)).toBe(markdown);
  });
});
