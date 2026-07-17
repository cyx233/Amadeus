import { useEffect } from 'react';

// One global ESC handler for all modals. Each open modal pushes its close
// callback onto a LIFO stack; a single capture-phase document listener closes
// the topmost one and stops propagation, so ESC never falls through to other
// handlers (e.g. the chat's abort-agent shortcut). Nested modals close
// top-first.
const modals: Array<() => void> = [];

let listening = false;
function ensureListener() {
  if (listening) return;
  listening = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.repeat || e.defaultPrevented || modals.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      modals[modals.length - 1]();
    },
    // Capture phase: intercept before component/global bubble listeners.
    true,
  );
}

/** Close this modal on ESC. Pass `open` so closed modals leave the stack. */
export function useModalEscape(onClose: () => void, open = true) {
  useEffect(() => {
    if (!open) return undefined;
    ensureListener();
    modals.push(onClose);
    return () => {
      const i = modals.lastIndexOf(onClose);
      if (i !== -1) modals.splice(i, 1);
    };
  }, [onClose, open]);
}
