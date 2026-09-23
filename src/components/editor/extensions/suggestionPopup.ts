/**
 * The floating list shared by the wiki-link, tag and slash suggestions.
 *
 * Popper measures against the layout viewport, which on iOS keeps its full
 * height while the software keyboard covers the bottom of it, so a list below
 * the caret ran on under the formatting row and the keyboard. Placement is
 * therefore chosen here against what is actually visible: the note's scroll
 * area, clipped to the visual viewport. The list goes below the caret unless
 * there is more room above, and is capped to the room it gets.
 */
import tippy, { type Instance } from 'tippy.js';
import type { Editor } from '@tiptap/core';

const GAP = 8;
const TALLEST = 360;

type ClientRect = (() => DOMRect | null) | null | undefined;

export interface PopupFit {
  placement: 'bottom-start' | 'top-start';
  maxHeight: number;
}

/** Where a list anchored at `caret` fits inside the band from `top` to `bottom`. */
export function fitSuggestionPopup(
  caret: Pick<DOMRect, 'top' | 'bottom'>,
  area: { top: number; bottom: number }
): PopupFit {
  const below = area.bottom - caret.bottom - GAP;
  const above = caret.top - area.top - GAP;
  const up = below < TALLEST && above > below;
  return {
    placement: up ? 'top-start' : 'bottom-start',
    maxHeight: Math.max(0, Math.floor(Math.min(TALLEST, up ? above : below))),
  };
}

function visibleArea(editor: Editor): { top: number; bottom: number } {
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? window.innerHeight);
  const paper = editor.view.dom.closest('.editor-paper')?.getBoundingClientRect();
  return {
    top: Math.max(top, paper?.top ?? top),
    bottom: Math.min(bottom, paper?.bottom ?? bottom),
  };
}

function fit(content: HTMLElement, editor: Editor, caret: DOMRect): PopupFit['placement'] {
  const { placement, maxHeight } = fitSuggestionPopup(caret, visibleArea(editor));
  content.style.setProperty('--suggestion-max-height', `${maxHeight}px`);
  return placement;
}

export function openSuggestionPopup(
  content: HTMLElement,
  props: { editor: Editor; clientRect?: ClientRect }
): Instance | null {
  const caret = props.clientRect?.();
  if (!caret) return null;
  const [instance] = tippy('body', {
    getReferenceClientRect: props.clientRect as () => DOMRect,
    appendTo: () => document.body,
    content,
    showOnCreate: true,
    interactive: true,
    trigger: 'manual',
    placement: fit(content, props.editor, caret),
    maxWidth: 'none',
    arrow: false,
    popperOptions: { modifiers: [{ name: 'flip', enabled: false }] },
  });
  return instance;
}

export function updateSuggestionPopup(
  instance: Instance | null,
  content: HTMLElement | undefined,
  props: { editor: Editor; clientRect?: ClientRect }
): void {
  const caret = props.clientRect?.();
  if (!instance || !content || !caret) return;
  instance.setProps({
    placement: fit(content, props.editor, caret),
    getReferenceClientRect: props.clientRect as () => DOMRect,
  });
}
