/** A file dropped where nothing takes it must not navigate the window away from the app. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWindowDropGuard, setWindowFileDropHandler } from './dropGuard';

function dragEvent(type: 'dragover' | 'drop', types: string[], files: File[] = []): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: { types, files } });
  return event;
}

let uninstall: () => void;

beforeEach(() => {
  uninstall = installWindowDropGuard();
});

afterEach(() => {
  uninstall();
});

describe('installWindowDropGuard', () => {
  it('cancels a file drag and drop that reaches the window', () => {
    const over = dragEvent('dragover', ['Files']);
    const drop = dragEvent('drop', ['Files']);

    document.body.dispatchEvent(over);
    document.body.dispatchEvent(drop);

    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('leaves drags that carry no files to the app', () => {
    const over = dragEvent('dragover', ['text/plain', 'application/x-moldavite-note']);
    const drop = dragEvent('drop', ['text/plain']);

    document.body.dispatchEvent(over);
    document.body.dispatchEvent(drop);

    expect(over.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
  });

  it('hands an untaken file drop to the registered handler, and not one an inner handler took', () => {
    const handler = vi.fn();
    const unregister = setWindowFileDropHandler(handler);
    const file = new File(['# hi'], 'note.md', { type: 'text/markdown' });
    const inner = document.createElement('div');
    document.body.appendChild(inner);

    document.body.dispatchEvent(dragEvent('drop', ['Files'], [file]));
    const taken = dragEvent('drop', ['Files'], [file]);
    inner.addEventListener('drop', (event) => event.preventDefault(), { once: true });
    inner.dispatchEvent(taken);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual([file]);
    unregister();
    inner.remove();
  });
});
