const uiEvents = [
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'mousedown',
  'mousemove',
  'mouseup',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'change',
  'submit',
  'reset',
  'copy',
  'cut',
  'paste',
  'dragstart',
  'dragover',
  'drop',
  'dragend',
  'wheel',
];

// ContentApp currently finishes pointer drags on document. Keep those trusted
// events bubbling until the drag handlers can live inside the shadow tree.
export const isolatedUiEvents = uiEvents.filter(
  (type) => type !== 'pointermove' && type !== 'pointerup',
);

export function prepareContentHost(host: HTMLElement, container: HTMLElement) {
  host.dataset.yijingUi = 'true';
  // WXT's default important shadow reset defeats even inline host positioning.
  // Use inheritStyles + our own normal reset, then protect the viewport shell
  // from page CSS. Visibility stays writable for screenshot capture.
  host.style.setProperty('all', 'initial');
  for (const [property, value] of Object.entries({
    position: 'fixed',
    display: 'block',
    top: '0px',
    left: '0px',
    right: 'auto',
    bottom: 'auto',
    width: '0px',
    height: '0px',
    margin: '0px',
    padding: '0px',
    border: '0px',
    overflow: 'visible',
    'z-index': '2147483647',
    'pointer-events': 'none',
    transform: 'none',
    filter: 'none',
    'backdrop-filter': 'none',
    perspective: 'none',
    contain: 'none',
    'content-visibility': 'visible',
    opacity: '1',
    isolation: 'isolate',
  })) {
    host.style.setProperty(property, value, 'important');
  }
  const controller = new AbortController();
  let dragging = false;
  for (const type of uiEvents) {
    container.addEventListener(
      type,
      (event) => {
        if (!event.isTrusted) {
          event.preventDefault();
          event.stopImmediatePropagation();
        } else if (event.type === 'pointerdown') {
          dragging = true;
        }
      },
      { capture: true, passive: false, signal: controller.signal },
    );
  }
  // The existing ball/card drag callbacks run on document, outside the shadow
  // guard. Reject forged drag events there too, but only during a UI gesture.
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    document.addEventListener(
      type,
      (event) => {
        if (!dragging) return;
        if (!event.isTrusted) {
          event.preventDefault();
          event.stopImmediatePropagation();
        } else if (event.type !== 'pointermove') {
          dragging = false;
        }
      },
      { capture: true, passive: false, signal: controller.signal },
    );
  }
  return () => controller.abort();
}
