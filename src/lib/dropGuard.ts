/**
 * Keeps a file dropped anywhere on the window from replacing the app.
 *
 * Tauri's own drop handling stays off (`dragDropEnabled: false`): on macOS it
 * claims every drag, so WebKit would see none and the editor's image drops and
 * every in-app drag would stop working. With it off, a file dropped where no
 * handler takes it makes WebKit navigate the whole window to `file:///…`.
 * React is gone after that, and the close guard the old page registered keeps
 * refusing to close the window.
 *
 * These listeners run in the bubble phase on `window`, after every inner
 * handler (the editor's image drop, the Index, the tab bar), and cancel only
 * drags that carry files. A drop nobody took goes to the handler set with
 * `setWindowFileDropHandler`.
 */

export type WindowFileDropHandler = (files: File[], event: DragEvent) => void;

let fileDropHandler: WindowFileDropHandler | null = null;

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Receive files dropped on the window where nothing else took them. Returns an unregister function. */
export function setWindowFileDropHandler(handler: WindowFileDropHandler): () => void {
  fileDropHandler = handler;
  return () => {
    if (fileDropHandler === handler) fileDropHandler = null;
  };
}

export function installWindowDropGuard(target: typeof window = window): () => void {
  const onDragOver = (event: DragEvent) => {
    if (carriesFiles(event)) event.preventDefault();
  };
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    const handled = event.defaultPrevented;
    event.preventDefault();
    if (!handled) fileDropHandler?.(Array.from(event.dataTransfer?.files ?? []), event);
  };
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
