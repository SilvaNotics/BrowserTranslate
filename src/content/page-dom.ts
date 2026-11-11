export interface Block {
  id: string;
  element: HTMLElement;
  text: string;
  translation?: HTMLElement;
  originalHidden: boolean;
  originalAria: string | null;
}
const forbidden =
  'script,style,noscript,pre,code,kbd,samp,textarea,input,select,button,svg,canvas,[contenteditable]:not([contenteditable="false"]),[data-yijing-ui],[data-yijing-translation],[translate="no"]';
function isVisible(element: HTMLElement) {
  if (getComputedStyle(element).visibility === 'hidden') return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      current.hidden ||
      current.getAttribute('aria-hidden') === 'true' ||
      style.display === 'none' ||
      style.contentVisibility === 'hidden'
    )
      return false;
  }
  return true;
}
export function readBlockText(element: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node instanceof HTMLElement && node !== element) {
      const style = getComputedStyle(node);
      if (
        node.matches(forbidden) ||
        node.hidden ||
        node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.contentVisibility === 'hidden'
      )
        return;
      if (node.tagName === 'BR') parts.push(' ');
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(element);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
export function collectBlocks(root: HTMLElement, known = new WeakSet<HTMLElement>()): Block[] {
  const output: Block[] = [];
  const candidates = root.querySelectorAll<HTMLElement>(
    'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,div,section,article,span',
  );
  for (const element of candidates) {
    if (
      known.has(element) ||
      element.closest(forbidden) ||
      element.querySelector(forbidden) ||
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true'
    )
      continue;
    if (
      element.querySelector(
        'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,div,section,article',
      )
    )
      continue;
    if (
      element.tagName === 'SPAN' &&
      element.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,div,section,article')
    )
      continue;
    const text = readBlockText(element);
    if (text.length < 2 || text.length > 6000 || !/[\p{L}\p{N}]/u.test(text)) continue;
    if (!isVisible(element)) continue;
    known.add(element);
    output.push({
      id: crypto.randomUUID(),
      element,
      text,
      originalHidden: element.hidden,
      originalAria: element.getAttribute('aria-hidden'),
    });
  }
  return output;
}
export function showTranslation(block: Block, text: string, mode: 'bilingual' | 'translation') {
  if (!block.element.isConnected) return;
  if (!block.translation) {
    block.translation = document.createElement('div');
    block.translation.dataset.yijingTranslation = block.id;
    block.translation.setAttribute('lang', '');
    Object.assign(block.translation.style, {
      whiteSpace: 'pre-wrap',
      margin: '0.4em 0 0.8em',
      lineHeight: '1.65',
      fontSize: 'inherit',
      color: 'inherit',
      borderInlineStart: '2px solid #4385ec',
      paddingInlineStart: '0.7em',
    });
    block.element.after(block.translation);
  }
  block.translation.textContent = text;
  if (mode === 'translation') {
    const links = document.createElement('span');
    Object.assign(links.style, { display: 'block', fontSize: '0.85em', marginTop: '0.35em' });
    for (const original of block.element.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      let url: URL;
      try {
        url = new URL(original.href, document.baseURI);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = original.textContent?.trim() || url.hostname;
      link.title = '原文链接：' + url.href;
      link.style.marginInlineEnd = '0.8em';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        original.click();
      });
      links.append(link);
    }
    if (links.childElementCount) block.translation.append(links);
  }
  block.element.hidden = mode === 'translation' || block.originalHidden;
  if (mode === 'translation') block.element.setAttribute('aria-hidden', 'true');
  else if (block.originalAria === null) block.element.removeAttribute('aria-hidden');
  else block.element.setAttribute('aria-hidden', block.originalAria);
}
export function restoreBlocks(blocks: Block[]) {
  for (const block of blocks) {
    block.translation?.remove();
    block.translation = undefined;
    block.element.hidden = block.originalHidden;
    if (block.originalAria === null) block.element.removeAttribute('aria-hidden');
    else block.element.setAttribute('aria-hidden', block.originalAria);
  }
}
