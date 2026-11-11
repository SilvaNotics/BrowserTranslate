export function bindSelectionShortcut(target: Document, trigger: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const down = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    if (e.key === 'Control' && !held && !e.repeat && !e.altKey && !e.shiftKey && !e.metaKey) {
      held = true;
      timer = setTimeout(() => {
        timer = undefined;
        trigger();
      }, 400);
    } else if (e.key !== 'Control') cancel();
  };
  const up = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    if (e.key === 'Control') {
      held = false;
      cancel();
    }
  };
  const blur = () => {
    held = false;
    cancel();
  };
  target.addEventListener('keydown', down, true);
  target.addEventListener('keyup', up, true);
  target.defaultView?.addEventListener('blur', blur);
  return () => {
    blur();
    target.removeEventListener('keydown', down, true);
    target.removeEventListener('keyup', up, true);
    target.defaultView?.removeEventListener('blur', blur);
  };
}
