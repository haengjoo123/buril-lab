/**
 * Moves the focus to an element when it appears. Used where the control that
 * had the focus has just gone away, so the focus is never left on nothing.
 * Declared once: a new function on every render would move the focus again.
 */
export const focusOnMount = (element: HTMLElement | null) => {
  element?.focus();
};
