export interface Block {
  id: string;
  element: HTMLElement;
  text: string;
  translation?: HTMLElement;
  original?: HTMLElement;
  originalStyle?: string | null;
  appliedStyle?: string | null;
  layout?: { property: string; value: string; priority: string }[];
  originalHidden: boolean;
  originalAria: string | null;
}
const forbidden =
  'script,style,noscript,pre,textarea,input,select,button,svg,canvas,[contenteditable]:not([contenteditable="false"]),[data-yijing-ui],[data-yijing-translation],[translate="no"]';
const blankInput = 'input:not([type]),input[type="text"],input[type="search"]';
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
        (node.matches(forbidden) && !node.matches(blankInput)) ||
        (!node.hasAttribute('data-yijing-original') &&
          (node.hidden ||
            node.getAttribute('aria-hidden') === 'true' ||
            style.display === 'none')) ||
        style.visibility === 'hidden' ||
        style.contentVisibility === 'hidden'
      )
        return;
      // Represent exercise blanks without reading any form value.
      const underlinedBlank =
        node.matches('span,u') &&
        !node.textContent?.trim() &&
        !node.children.length &&
        (style.textDecorationLine.includes('underline') ||
          (parseFloat(style.borderBottomWidth) > 0 &&
            !['none', 'hidden'].includes(style.borderBottomStyle)));
      if (node.matches(blankInput) || underlinedBlank) {
        parts.push(' 【待补全】 ');
        return;
      }
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
      element.closest(forbidden + ',code,kbd,samp') ||
      element.closest('[data-yijing-original]') ||
      Array.from(element.querySelectorAll(forbidden)).some((node) => !node.matches(blankInput)) ||
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
    if (element.querySelector('code,kbd,samp')) {
      const prose = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          return parent &&
            /[\p{L}\p{N}]/u.test(node.textContent ?? '') &&
            !parent.closest(forbidden + ',code,kbd,samp') &&
            isVisible(parent)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      if (!prose.nextNode()) continue;
    }
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
    const style = getComputedStyle(block.element);
    block.translation = document.createElement('span');
    block.translation.dataset.yijingTranslation = block.id;
    block.translation.setAttribute('lang', '');
    Object.assign(block.translation.style, {
      all: 'unset',
      display: 'block',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      margin: '0.3em 0 0',
      lineHeight: 'inherit',
      fontSize: 'inherit',
      color: 'inherit',
      minWidth: '0',
      maxWidth: '100%',
      boxSizing: 'border-box',
    });
    if (style.display === 'flex' || style.display === 'inline-flex') {
      block.originalStyle = block.element.getAttribute('style');
      block.layout = ['flex-wrap'].map((property) => ({
        property,
        value: block.element.style.getPropertyValue(property),
        priority: block.element.style.getPropertyPriority(property),
      }));
      block.element.style.setProperty('flex-wrap', 'wrap', 'important');
      block.appliedStyle = block.element.getAttribute('style');
      // Row flex items must start a new line; column flex already stacks children.
      if (!style.flexDirection.startsWith('column')) block.translation.style.flexBasis = '100%';
      block.translation.style.order =
        style.flexDirection === 'column-reverse' ? '-2147483647' : '2147483647';
    }
    if (style.display === 'grid' || style.display === 'inline-grid') {
      block.translation.style.gridColumn = '1 / -1';
      const rows = style.gridTemplateRows.split(' ').length;
      block.translation.style.gridRowStart = String(rows + 1);
      block.translation.style.order = '2147483647';
    }
    block.element.append(block.translation);
  }
  block.translation.textContent = text;
  if (mode === 'translation') {
    if (!block.original) {
      block.original = document.createElement('span');
      block.original.dataset.yijingOriginal = block.id;
      block.original.hidden = true;
      block.original.style.setProperty('display', 'none', 'important');
      block.original.setAttribute('aria-hidden', 'true');
      block.original.append(
        ...Array.from(block.element.childNodes).filter((node) => node !== block.translation),
      );
      block.element.prepend(block.original);
    }
    const links = document.createElement('span');
    Object.assign(links.style, { display: 'block', fontSize: '0.85em', marginTop: '0.35em' });
    for (const original of block.original!.querySelectorAll<HTMLAnchorElement>('a[href]')) {
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
  } else if (block.original) {
    block.original.replaceWith(...block.original.childNodes);
    block.original = undefined;
  }
}
export function restoreBlocks(blocks: Block[]) {
  for (const block of blocks) {
    block.translation?.remove();
    block.translation = undefined;
    if (block.original) {
      block.original.replaceWith(...block.original.childNodes);
      block.original = undefined;
    }
    if (block.layout && block.element.getAttribute('style') === block.appliedStyle) {
      if (block.originalStyle === null) block.element.removeAttribute('style');
      else block.element.setAttribute('style', block.originalStyle!);
    } else {
      for (const { property, value, priority } of block.layout ?? []) {
        if (value) block.element.style.setProperty(property, value, priority);
        else block.element.style.removeProperty(property);
      }
      if (block.layout && block.originalStyle === null && block.element.style.length === 0)
        block.element.removeAttribute('style');
    }
    block.layout = undefined;
    block.element.hidden = block.originalHidden;
    if (block.originalAria === null) block.element.removeAttribute('aria-hidden');
    else block.element.setAttribute('aria-hidden', block.originalAria);
  }
}
