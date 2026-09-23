/**
 * The shipped stylesheets applied to note content. jsdom does no layout, so
 * these assert the cascaded rules, not the painted result.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Read from disk: the test config turns CSS off, so a `?raw` import is empty.
const css = ['src/index.css', 'src/mobile.css', 'src/components/editor/extensions/wiki-links.css']
  .map((file) => readFileSync(join(process.cwd(), file), 'utf8'))
  .join('\n');

let style = document.createElement('style');

beforeEach(() => {
  style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
});

afterEach(() => {
  style.remove();
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.platform;
});

function computed(selector: string) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`No ${selector}`);
  return getComputedStyle(element);
}

describe.each(['light', 'dark'])('links in a %s note', (theme) => {
  beforeEach(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    document.body.innerHTML =
      '<div class="tiptap"><p>' +
      '<a href="https://example.com"><strong><em>formatted</em></strong></a> ' +
      '<wiki-link class="wiki-link-exists" data-target="a.md">exists</wiki-link> ' +
      '<wiki-link class="wiki-link-missing" data-target="b.md">missing</wiki-link> ' +
      '<strong><em>plain</em></strong>' +
      '</p></div>';
  });

  it('keeps the link hue through bold and italic inside a link', () => {
    expect(computed('a em').color).toBe('var(--syntax-link)');
    expect(computed('a strong').color).toBe('var(--syntax-link)');
    expect(computed('p > strong > em').color).toBe('var(--text-primary)');
  });

  it('gives wiki links the same hue as URLs, whether or not the note exists', () => {
    expect(computed('wiki-link.wiki-link-exists').color).toBe('var(--syntax-link)');
    expect(computed('wiki-link.wiki-link-missing').color).toBe('var(--syntax-link)');
  });

  it('draws the resting hairline, dashed for a missing note', () => {
    // jsdom has no pseudo-elements. Every `::after` becomes a child element,
    // which adds the same specificity to each such rule and so keeps the
    // order in which they win.
    style.textContent = css.replace(/::after/g, ' > i.after');
    for (const link of document.querySelectorAll('.tiptap :is(a, wiki-link)')) {
      link.appendChild(document.createElement('i')).className = 'after';
    }
    for (const selector of ['a', 'wiki-link.wiki-link-exists', 'wiki-link.wiki-link-missing']) {
      expect(computed(`${selector} > i.after`).transform).toBe('scaleX(1)');
    }
    expect(computed('wiki-link.wiki-link-missing > i.after').borderBottomStyle).toBe('dashed');
    expect(computed('wiki-link.wiki-link-exists > i.after').borderBottomStyle).not.toBe('dashed');
  });
});

describe.each(['desktop', 'mobile'])('task items on %s', (platform) => {
  let editor: Editor;

  beforeEach(() => {
    if (platform === 'mobile') document.documentElement.dataset.platform = 'mobile';
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
      content:
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>A task long enough to wrap</p></li></ul>',
    });
  });

  afterEach(() => editor.destroy());

  it('anchors the checkbox to the first line of the item the editor draws', () => {
    // The node view draws the <li> without data-type="taskItem", so the rule
    // that applies has to be the one that does not ask for it.
    expect(computed('.tiptap ul[data-type="taskList"] > li').alignItems).toBe('flex-start');
    expect(computed('.tiptap ul[data-type="taskList"] > li > label').height).toBe(
      'calc(var(--editor-line-height) * 1em)'
    );
  });

  it('spaces tasks like bullet items, without a paragraph gap under each', () => {
    expect(computed('.tiptap ul[data-type="taskList"] > li > div > p').marginBottom).toBe('0px');
  });
});

it('sets an ink caret on the phone, which also colours the native selection handles', () => {
  document.documentElement.dataset.platform = 'mobile';
  expect(getComputedStyle(document.documentElement).caretColor).toBe('var(--text-primary)');
});

it('keeps footer menus in the UI face rather than the footer’s mono small caps', () => {
  document.body.innerHTML =
    '<div class="editor-footer"><div role="menu"><button role="menuitem">Bold</button></div></div>';
  expect(computed('[role="menuitem"]').fontFamily).toBe('var(--font-sans)');
  expect(computed('[role="menuitem"]').textTransform).toBe('none');
});

it('does not ship tippy’s dark box: the stock theme is not imported', () => {
  const editorSource = readFileSync(
    join(process.cwd(), 'src/components/editor/Editor.tsx'),
    'utf8'
  );
  expect(editorSource).not.toContain('tippy.js/dist/tippy.css');
  document.body.innerHTML = '<div class="tippy-box"><div class="tippy-content">x</div></div>';
  expect(computed('.tippy-box').backgroundColor).not.toBe('rgb(51, 51, 51)');
});

it('lifts the title above the empty-note template layer so a tap renames', () => {
  document.body.innerHTML =
    '<div class="editor-paper" data-template-prompt=""><header class="note-header"></header></div>';
  expect(computed('.note-header').position).toBe('relative');
  expect(Number(computed('.note-header').zIndex)).toBeGreaterThan(10);
});
