"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Focus goes back where it was when a dialog closes (WCAG 2.4.3).
 *
 * Radix returns focus to a `Dialog.Trigger`, but our dialogs open from
 * state (after a form validates, from a table row), so there is no trigger
 * and focus fell to the top of the page. Pass the returned handler as
 * `onCloseAutoFocus`. The element is captured in a layout effect, which
 * runs before Radix moves focus into the dialog (a passive effect).
 */
export function useReturnFocus(open: boolean): (event: Event) => void {
  const origin = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      origin.current = document.activeElement;
    }
  }, [open]);
  return useCallback((event: Event) => {
    const target = origin.current;
    if (target && target.isConnected) {
      event.preventDefault();
      target.focus();
    }
  }, []);
}
