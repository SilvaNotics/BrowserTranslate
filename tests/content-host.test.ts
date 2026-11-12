import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement, act, useEffect, useState } from 'react';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock('../src/content/App', () => ({
  ContentApp() {
    const [value, setValue] = useState('original');
    useEffect(() => {
      lifecycle.mounts++;
      return () => {
        lifecycle.unmounts++;
      };
    }, []);
    return createElement(
      'div',
      null,
      createElement('button', { onClick: () => setValue('clicked') }, value),
      createElement('input', { onInput: () => setValue('input') }),
    );
  },
}));

let ui: Awaited<ReturnType<typeof createShadowRootUi>>;
let contextController: AbortController;
const ctx = {
  onInvalidated(callback: () => void) {
    contextController.signal.addEventListener('abort', callback);
  },
  addEventListener(target: EventTarget, type: string, callback: EventListener) {
    target.addEventListener(type, callback, { signal: contextController.signal });
  },
} as unknown as Parameters<typeof createShadowRootUi>[0];

beforeEach(async () => {
  contextController = new AbortController();
  lifecycle.mounts = lifecycle.unmounts = 0;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('defineContentScript', (options: unknown) => options);
  vi.stubGlobal('createShadowRootUi', async (...args: Parameters<typeof createShadowRootUi>) => {
    ui = await createShadowRootUi(...args);
    return ui;
  });
  history.replaceState(null, '', '/');
  const script = (await import('../entrypoints/translate.content')).default;
  await act(async () => {
    await script.main(ctx);
  });
});
afterEach(async () => {
  await act(async () => {
    ui?.remove();
    contextController.abort();
  });
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('keeps the viewport host above site stacking contexts without intercepting the page', () => {
  expect(ui.shadowHost.style.position).toBe('fixed');
  expect(ui.shadowHost.style.zIndex).toBe('2147483647');
  expect(ui.shadowHost.style.pointerEvents).toBe('none');
  expect(ui.shadowHost.style.width).toBe('0px');
  expect(ui.shadowHost.style.height).toBe('0px');
});

it('preserves the mounted React tree when the site replaces its body', () => {
  const button = ui.shadow.querySelector('button');
  document.body.replaceWith(document.createElement('body'));
  expect(ui.shadowHost.isConnected).toBe(true);
  expect(ui.shadow.querySelector('button')).toBe(button);
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
});

it.each([
  'click',
  'input',
  'change',
  'beforeinput',
  'submit',
  'keydown',
  'pointerdown',
  'pointermove',
  'pointerup',
])('rejects untrusted %s before it reaches application handlers', async (type) => {
  const input = ui.shadow.querySelector('input')!;
  const listener = vi.fn();
  input.addEventListener(type, listener);
  const event = new Event(type, { bubbles: true, composed: true, cancelable: true });
  await act(async () => {
    input.dispatchEvent(event);
  });
  expect(listener).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(true);
  expect(ui.shadow.querySelector('button')?.textContent).toBe('original');
});

it('unmounts once and removes its navigation listener before a later mount', async () => {
  await act(async () => {
    ui.remove();
  });
  await act(async () => {
    window.dispatchEvent(new Event('wxt:locationchange'));
  });
  expect(lifecycle).toEqual({ mounts: 1, unmounts: 1 });
  await act(async () => {
    ui.mount();
  });
  expect(lifecycle).toEqual({ mounts: 2, unmounts: 1 });
});
