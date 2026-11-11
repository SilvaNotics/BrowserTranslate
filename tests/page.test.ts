import { it, expect, vi } from 'vitest';
import { collectBlocks, showTranslation, restoreBlocks } from '../src/content/page-dom';
import { bindSelectionShortcut } from '../src/content/shortcuts';
it('跳过隐藏祖先下的文字，但保留屏幕外的正常段落', () => {
  document.body.innerHTML =
    '<div hidden><p>Hidden attribute secret</p></div><div style="display:none"><p>Hidden style secret</p></div><p style="position:absolute;top:5000px">Visible article below fold</p>';
  expect(collectBlocks(document.body).map((block) => block.text)).toEqual([
    'Visible article below fold',
  ]);
});
it('可见段落中的隐藏内联文字不会进入模型输入', () => {
  document.body.innerHTML =
    '<p>Visible <span hidden>private draft</span><span style="display:none">private inline</span>sentence.</p>';
  expect(collectBlocks(document.body).map((block) => block.text)).toEqual(['Visible sentence.']);
});
it('仅译文模式保留可操作的原文链接，恢复时移除代理链接', () => {
  document.body.innerHTML = '<p>Visit <a href="https://example.com">the website</a>.</p>';
  const original = document.querySelector('a')!;
  const clicked = vi.fn();
  original.addEventListener('click', (e) => {
    e.preventDefault();
    clicked();
  });
  const blocks = collectBlocks(document.body);
  showTranslation(blocks[0]!, '访问网站。', 'translation');
  const proxy = blocks[0]!.translation!.querySelector('a');
  expect(proxy).not.toBeNull();
  proxy!.click();
  expect(clicked).toHaveBeenCalledOnce();
  restoreBlocks(blocks);
  expect(document.querySelectorAll('a')).toHaveLength(1);
});
it('提取段落不重复，不处理代码和表单，恢复后原链接事件仍有效', () => {
  document.body.innerHTML =
    '<article><p>Hello <a href="/x">world</a>.</p><div><p>Second paragraph.</p></div><pre>code text</pre><input value="secret"><div contenteditable="true">editable</div></article>';
  const anchor = document.querySelector('a')!;
  const onClick = vi.fn();
  anchor.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  const blocks = collectBlocks(document.body);
  expect(blocks.map((b) => b.text)).toEqual(['Hello world.', 'Second paragraph.']);
  showTranslation(blocks[0]!, '你好，世界。', 'bilingual');
  expect(document.body.textContent).toContain('你好，世界。');
  showTranslation(blocks[0]!, '你好，世界。', 'translation');
  expect(blocks[0]!.element.hidden).toBe(true);
  restoreBlocks(blocks);
  expect(blocks[0]!.element.hidden).toBe(false);
  expect(document.querySelector('a')).toBe(anchor);
  anchor.dispatchEvent(new MouseEvent('click', { cancelable: true }));
  expect(onClick).toHaveBeenCalledOnce();
});
it('Ctrl 必须持续 400ms，组合键和释放均取消', () => {
  vi.useFakeTimers();
  const trigger = vi.fn();
  const listeners = new Map<string, (event: KeyboardEvent) => void>();
  const target = {
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as Document;
  const dispatch = (type: string, key: string) =>
    listeners.get(type)!({ key, isTrusted: true, ctrlKey: true } as KeyboardEvent);
  const clean = bindSelectionShortcut(target, trigger);
  dispatch('keydown', 'Control');
  vi.advanceTimersByTime(399);
  expect(trigger).not.toHaveBeenCalled();
  dispatch('keyup', 'Control');
  vi.advanceTimersByTime(10);
  expect(trigger).not.toHaveBeenCalled();
  dispatch('keydown', 'Control');
  dispatch('keydown', 'c');
  vi.advanceTimersByTime(400);
  expect(trigger).not.toHaveBeenCalled();
  dispatch('keyup', 'Control');
  dispatch('keydown', 'Control');
  vi.advanceTimersByTime(400);
  expect(trigger).toHaveBeenCalledOnce();
  clean();
  vi.useRealTimers();
});
it('网页脚本合成的 Ctrl 事件不触发翻译', () => {
  vi.useFakeTimers();
  const trigger = vi.fn();
  const clean = bindSelectionShortcut(document, trigger);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
  vi.advanceTimersByTime(500);
  expect(trigger).not.toHaveBeenCalled();
  clean();
  vi.useRealTimers();
});
