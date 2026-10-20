import { useEffect, useRef, type RefObject } from 'react';

export function isTopmostDialog(dialog: HTMLElement) {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
    .filter(element => element.getClientRects().length > 0);
  const layer = (element: HTMLElement) => Number(getComputedStyle(element.closest('.adaptive-overlay') ?? element).zIndex) || 0;
  dialogs.sort((a, b) => layer(a) - layer(b));
  const top = dialogs.at(-1);
  return !top || top === dialog;
}

/** Preserve a mounted dialog while resizing; use its usual close policy for native back. */
export function useAdaptiveDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true, manageFocus = true) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!enabled || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (manageFocus) dialog.focus({ preventScroll: true });
    const back = (event: Event) => {
      if (event.defaultPrevented || !isTopmostDialog(dialog)) return;
      event.preventDefault(); close.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!isTopmostDialog(dialog)) return;
      if (event.key === 'Escape') { back(event); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('buril:adaptive-back', back);
    if (manageFocus) document.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('buril:adaptive-back', back);
      if (manageFocus) { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus({ preventScroll: true }); }
    };
  }, [enabled, manageFocus, ref]);
}
