import { it, expect, vi } from 'vitest';
import {
  collectBlocks,
  readBlockText,
  showTranslation,
  restoreBlocks,
} from '../src/content/page/dom';
import { bindSelectionShortcut } from '../src/content/shortcuts';
it('独立代码即使包装在普通容器中也不翻译，含内联代码的自然语言仍翻译', () => {
  document.body.innerHTML =
    '<div><code>int main() { return 0; }</code></div>' +
    '<p><span><code>const x = 1;</code></span></p>' +
    '<p>Call <code>bind()</code> first.</p>';
  expect(collectBlocks(document.body).map((block) => block.text)).toEqual(['Call bind() first.']);
});
it('带下划线样式的空白占位保留为待补全标记，普通空白不误判', () => {
  document.body.innerHTML =
    '<p>Nine-year <span style="display:inline-block;border-bottom:1px solid;width:100px">&nbsp;</span> education.</p>' +
    '<p>Ordinary <span> </span> spacing.</p>';
  expect(collectBlocks(document.body).map((block) => block.text)).toEqual([
    'Nine-year 【待补全】 education.',
    'Ordinary spacing.',
  ]);
});
it('填空题中的文本输入框作为空缺参与整句翻译，不读取答案或私密表单', () => {
  document.body.innerHTML =
    '<p>Thanks to its nine-year <input value="private answer"> education.</p>' +
    '<p>He has been ______ leaving the studio.</p><p>Password <input type="password" value="secret"></p>';
  const input = document.querySelector('input');
  const original = document.body.innerHTML;
  const blocks = collectBlocks(document.body);
  expect(blocks.map((block) => block.text)).toEqual([
    'Thanks to its nine-year 【待补全】 education.',
    'He has been ______ leaving the studio.',
  ]);
  showTranslation(blocks[0]!, '得益于九年【义务】教育。', 'translation');
  expect(readBlockText(blocks[0]!.element)).toBe('Thanks to its nine-year 【待补全】 education.');
  restoreBlocks(blocks);
  expect(document.body.innerHTML).toBe(original);
  expect(document.querySelector('input')).toBe(input);
});
it('技术文档中的内联代码不导致整段漏翻，切换模式和恢复保留原节点', () => {
  document.body.innerHTML =
    '<p>Call <code>bind()</code> before <code>connect()</code>, using <code>struct</code>.</p>' +
    '<p>The compiler uses <span><code>gcc</code></span>. Press <kbd>Ctrl</kbd> to continue.</p>' +
    '<pre><code>Do not translate this program</code></pre><code>standalone_code</code>';
  const original = document.body.innerHTML;
  const code = document.querySelector('code');
  const known = new WeakSet<HTMLElement>();
  const blocks = collectBlocks(document.body, known);
  expect(blocks.map((block) => block.text)).toEqual([
    'Call bind() before connect(), using struct.',
    'The compiler uses gcc. Press Ctrl to continue.',
  ]);
  for (const block of blocks) {
    showTranslation(block, '技术段落译文', 'translation');
    expect(block.original?.hidden).toBe(true);
    expect(readBlockText(block.element)).toBe(block.text);
  }
  expect(collectBlocks(document.body, known)).toHaveLength(0);
  for (const block of blocks) showTranslation(block, '技术段落译文', 'bilingual');
  restoreBlocks(blocks);
  expect(document.body.innerHTML).toBe(original);
  expect(document.querySelector('code')).toBe(code);
});
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
  expect(blocks[0]!.element.querySelector<HTMLElement>('[data-yijing-original]')!.hidden).toBe(
    true,
  );
  restoreBlocks(blocks);
  expect(blocks[0]!.element.hidden).toBe(false);
  expect(document.querySelector('a')).toBe(anchor);
  anchor.dispatchEvent(new MouseEvent('click', { cancelable: true }));
  expect(onClick).toHaveBeenCalledOnce();
});
it('双语译文留在原文本容器内，扫描不会重复读取译文，恢复保留原节点', () => {
  document.body.innerHTML =
    '<div style="display:flex;gap:12px"><p>Hello <a href="/x">world</a>.</p><aside>Other column</aside></div>';
  const paragraph = document.querySelector('p')!;
  const link = document.querySelector('a')!;
  const blocks = collectBlocks(document.body);
  const block = blocks.find((item) => item.element === paragraph)!;
  showTranslation(block, '你好，世界。', 'bilingual');
  expect(block.translation!.parentElement).toBe(paragraph);
  expect(paragraph.querySelector(':scope > a')).toBe(link);
  expect(paragraph.parentElement!.children).toHaveLength(2);
  expect(readBlockText(paragraph)).toBe('Hello world.');
  expect(block.translation!.style.borderInlineStart).toBe('');
  showTranslation(block, '你好，世界。', 'translation');
  expect(paragraph.hidden).toBe(false);
  expect(block.translation!.parentElement).toBe(paragraph);
  showTranslation(block, '你好，世界。', 'bilingual');
  expect(paragraph.querySelector('[data-yijing-original]')).toBeNull();
  expect(paragraph.querySelector(':scope > a')).toBe(link);
  restoreBlocks(blocks);
  expect(paragraph.innerHTML).toBe('Hello <a href="/x">world</a>.');
  expect(paragraph.querySelector('a')).toBe(link);
});
it('倒序纵向 flex 容器仍将译文放在原文下方', () => {
  document.body.innerHTML =
    '<div style="display:flex;flex-direction:column-reverse">Original label</div>';
  const block = collectBlocks(document.body)[0]!;
  showTranslation(block, '标签译文', 'bilingual');
  expect(Number(block.translation!.style.order)).toBeLessThan(0);
  restoreBlocks([block]);
});
it('横向 flex 文本的译文单独换行，恢复时还原原来的内联样式', () => {
  document.body.innerHTML =
    '<div id="label" style="display:flex;flex-wrap:nowrap !important">Original label</div>';
  const block = collectBlocks(document.body)[0]!;
  const originalStyle = block.element.getAttribute('style');
  showTranslation(block, '标签译文', 'bilingual');
  expect(block.element.style.flexWrap).toBe('wrap');
  expect(block.translation!.style.flexBasis).toBe('100%');
  restoreBlocks([block]);
  expect(block.element.style.flexWrap).toBe('nowrap');
  expect(block.element.style.getPropertyPriority('flex-wrap')).toBe('important');
  expect(block.element.getAttribute('style')).toBe(originalStyle);
});
it('动态扫描不会把导航内的原文包装当成新段落再次翻译', () => {
  document.body.innerHTML = '<nav><span>Dashboard</span><span>Repositories</span></nav>';
  const known = new WeakSet<HTMLElement>();
  const blocks = collectBlocks(document.body, known);
  for (const block of blocks) showTranslation(block, '导航译文', 'bilingual');
  expect(collectBlocks(document.body, known)).toHaveLength(0);
  restoreBlocks(blocks);
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
