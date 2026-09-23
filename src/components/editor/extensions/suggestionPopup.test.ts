import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { fitSuggestionPopup, openSuggestionPopup, updateSuggestionPopup } from './suggestionPopup';

describe('fitting a suggestion list beside the caret', () => {
  const area = { top: 60, bottom: 540 };

  it('opens below the caret when the list fits there', () => {
    expect(fitSuggestionPopup({ top: 100, bottom: 120 }, area)).toEqual({
      placement: 'bottom-start',
      maxHeight: 360,
    });
  });

  it('flips above the caret when more of it shows there, and caps it to that room', () => {
    // The caret sits low, just over the formatting row and the keyboard.
    expect(fitSuggestionPopup({ top: 500, bottom: 520 }, area)).toEqual({
      placement: 'top-start',
      maxHeight: 360,
    });
    expect(fitSuggestionPopup({ top: 320, bottom: 340 }, area)).toEqual({
      placement: 'top-start',
      maxHeight: 252,
    });
  });

  it('stays below and shrinks when below is the larger room', () => {
    expect(fitSuggestionPopup({ top: 200, bottom: 220 }, area)).toEqual({
      placement: 'bottom-start',
      maxHeight: 312,
    });
  });
});

describe('the suggestion popup', () => {
  let editor: Editor;
  afterEach(() => {
    editor?.destroy();
    document.body.innerHTML = '';
  });

  it('draws no arrow and hands the list its height cap', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({ element, extensions: [StarterKit], content: '<p>x</p>' });
    const content = document.createElement('div');
    const caret = () => new DOMRect(0, 0, 0, 0);

    const popup = openSuggestionPopup(content, { editor, clientRect: caret });
    expect(popup).not.toBeNull();
    expect(document.querySelector('.tippy-arrow')).toBeNull();
    expect(content.style.getPropertyValue('--suggestion-max-height')).toMatch(/^\d+px$/);

    content.style.removeProperty('--suggestion-max-height');
    updateSuggestionPopup(popup, content, { editor, clientRect: caret });
    expect(content.style.getPropertyValue('--suggestion-max-height')).toMatch(/^\d+px$/);
    popup?.destroy();
  });

  it('opens nothing without a caret to anchor to', () => {
    const element = document.createElement('div');
    editor = new Editor({ element, extensions: [StarterKit], content: '<p>x</p>' });
    expect(openSuggestionPopup(document.createElement('div'), { editor })).toBeNull();
  });
});
