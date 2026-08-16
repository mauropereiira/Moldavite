import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ModalEntry {
  id: symbol;
  escape: () => void;
}

const modalStack: ModalEntry[] = [];

function handleModalKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || modalStack.length === 0) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  modalStack[modalStack.length - 1].escape();
}

function pushModal(entry: ModalEntry) {
  if (modalStack.length === 0) {
    window.addEventListener('keydown', handleModalKeyDown);
  }
  modalStack.push(entry);

  return () => {
    const index = modalStack.findIndex((candidate) => candidate.id === entry.id);
    if (index !== -1) modalStack.splice(index, 1);
    if (modalStack.length === 0) {
      window.removeEventListener('keydown', handleModalKeyDown);
    }
  };
}

type DialogName =
  | { 'aria-label': string; 'aria-labelledby'?: string }
  | { 'aria-label'?: string; 'aria-labelledby': string };

export type DialogSurfaceProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'aria-label' | 'aria-labelledby'
> &
  DialogName & {
    /** Omit while Escape should be blocked, for example during a destructive save. */
    onEscape?: () => void;
  };

/**
 * Behaviour-only dialog primitive. Callers retain their existing backdrop,
 * layout, and visual classes while this supplies semantics, focus containment,
 * focus restoration, and topmost-only Escape handling.
 */
export const DialogSurface = forwardRef<HTMLDivElement, DialogSurfaceProps>(function DialogSurface(
  { onEscape, tabIndex = -1, ...props },
  forwardedRef
) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const escapeRef = useRef(onEscape);

  useLayoutEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const entry: ModalEntry = {
      id: Symbol('modal'),
      escape: () => escapeRef.current?.(),
    };
    return pushModal(entry);
  }, []);

  const setDialogRef = useCallback(
    (node: HTMLDivElement | null) => {
      dialogRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef]
  );

  return <div {...props} ref={setDialogRef} role="dialog" aria-modal="true" tabIndex={tabIndex} />;
});
