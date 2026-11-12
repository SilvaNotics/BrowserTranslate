interface LayoutChange {
  element: HTMLElement;
  originalStyle: string | null;
  appliedStyle: string | null;
  properties: { property: string; value: string; priority: string; applied: string }[];
}
export interface Block {
  id: string;
  element: HTMLElement;
  text: string;
  language?: string;
  translation?: HTMLElement;
  original?: HTMLElement;
  originals?: HTMLElement[];
  layout?: LayoutChange[];
  originalHidden: boolean;
  originalAria: string | null;
}
const forbidden =
  'script,style,noscript,template,pre,textarea,input,select,button,svg,canvas,iframe,object,embed,video,audio,img,picture,[contenteditable]:not([contenteditable="false"]),[data-yijing-ui],[data-yijing-translation],[translate="no"]';
const blockTags =
  'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,div,section,article,main,aside,header,footer,figure';
const candidatesSelector = blockTags + ',span,a[href]';
const proseTags = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd';
function isStandaloneLink(element: Element) {
  if (!element.matches('a[href]')) return false;
  const owner = element.parentElement?.closest(blockTags);
  if (!owner) return true;
  if (owner.matches(proseTags)) return false;
  if (element.closest('nav,[role="navigation"]')) return true;
  const hasProse = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) return /[\p{L}\p{N}]/u.test(node.textContent ?? '');
    if (
      node instanceof Element &&
      node !== owner &&
      node.matches(blockTags + ',' + forbidden + ',a[href]')
    )
      return false;
    return Array.from(node.childNodes).some(hasProse);
  };
  return !hasProse(owner);
}
export function readBlockLanguage(element: HTMLElement, text: string): string | undefined {
  const source =
    Array.from(element.querySelectorAll<HTMLElement>('[lang]')).find(
      (child) => !child.closest('[data-yijing-translation]') && readBlockText(child) === text,
    ) ?? element;
  return source.closest('[lang]')?.getAttribute('lang')?.trim().slice(0, 100) || undefined;
}
function changeLayout(block: Block, element: HTMLElement, values: Record<string, string>) {
  block.layout ??= [];
  let change = block.layout.find((item) => item.element === element);
  if (!change) {
    change = {
      element,
      originalStyle: element.getAttribute('style'),
      appliedStyle: null,
      properties: [],
    };
    block.layout.push(change);
  }
  for (const [property, value] of Object.entries(values)) {
    change.properties.push({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
      applied: value,
    });
    element.style.setProperty(property, value, 'important');
  }
  change.appliedStyle = element.getAttribute('style');
}
const sensitive =
  'textarea,select,input[type]:not([type="text"]):not([type="search"]),[contenteditable]:not([contenteditable="false"])';
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
    if (node instanceof Element && node !== element) {
      if (
        !node.hasAttribute('data-yijing-original') &&
        (node.matches(blockTags) || isStandaloneLink(node))
      )
        return;
      const style = getComputedStyle(node);
      if (
        (node.matches(forbidden) && !node.matches(blankInput)) ||
        (!node.hasAttribute('data-yijing-original') &&
          (node.hasAttribute('hidden') ||
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
        parts.push(' [待补全] ');
        return;
      }
      if (node.tagName === 'BR') parts.push(' ');
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(element);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
export function scanRoot(element: HTMLElement): HTMLElement {
  const link = element.closest<HTMLElement>('a[href]');
  if (link && isStandaloneLink(link)) return link;
  return element.closest<HTMLElement>(blockTags) ?? element;
}
export function collectBlocks(root: HTMLElement, known = new WeakSet<HTMLElement>()): Block[] {
  const output: Block[] = [];
  const candidates = [
    ...(root.matches(candidatesSelector) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(candidatesSelector),
  ];
  for (const element of candidates) {
    if (
      known.has(element) ||
      element.closest(forbidden + ',code,kbd,samp') ||
      element.closest('[data-yijing-original]') ||
      element.querySelector(sensitive) ||
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true'
    )
      continue;
    if (element.matches('a[href]') && !isStandaloneLink(element)) continue;
    if (element.tagName === 'SPAN' && element.parentElement?.closest(blockTags + ',a[href]'))
      continue;
    const text = readBlockText(element);
    if (text.length < 2 || !/\p{L}/u.test(text.replaceAll('[待补全]', ''))) continue;
    if (element.querySelector('code,kbd,samp')) {
      const prose = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          // Match readBlockText's boundary: nested paragraphs are independent
          // blocks, not evidence that this container's code is natural prose.
          for (
            let current = parent;
            current && current !== element;
            current = current.parentElement
          )
            if (current.matches(blockTags) && !current.hasAttribute('data-yijing-original'))
              return NodeFilter.FILTER_REJECT;
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
      language: readBlockLanguage(element, text),
      originalHidden: element.hidden,
      originalAria: element.getAttribute('aria-hidden'),
    });
  }
  return output;
}
export function showTranslation(block: Block, text: string, mode: 'bilingual' | 'translation') {
  if (!block.element.isConnected) return;
  if (!block.translation) {
    // A title consisting entirely of one link keeps its translated title clickable.
    const onlyLink = Array.from(block.element.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (link) => !link.querySelector(blockTags) && readBlockText(link) === block.text,
    );
    const host = onlyLink ?? block.element;
    const style = getComputedStyle(host);
    for (const element of new Set([block.element, host])) {
      const computed = getComputedStyle(element);
      if (
        computed.whiteSpace === 'nowrap' ||
        (computed.webkitLineClamp && computed.webkitLineClamp !== 'none') ||
        ['hidden', 'clip'].includes(computed.overflowY) ||
        ['hidden', 'clip'].includes(computed.overflow)
      ) {
        changeLayout(block, element, {
          'white-space': 'normal',
          overflow: 'visible',
          'text-overflow': 'clip',
          '-webkit-line-clamp': 'unset',
          height: 'auto',
          'max-height': 'none',
        });
      }
    }
    block.translation = document.createElement('span');
    block.translation.dataset.yijingTranslation = block.id;
    block.translation.setAttribute('lang', '');
    Object.assign(block.translation.style, {
      all: 'unset',
      display: 'block',
      whiteSpace: 'pre-line',
      overflowWrap: 'anywhere',
      margin: '0.3em 0 0',
      lineHeight: 'inherit',
      fontSize: 'inherit',
      color: 'inherit',
      minWidth: '0',
      maxWidth: '100%',
      boxSizing: 'border-box',
      textIndent: '0',
    });
    if (style.display === 'flex' || style.display === 'inline-flex') {
      changeLayout(block, host, { 'flex-wrap': 'wrap' });
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
    // Keep the translation beside this container's prose, before a trailing image
    // or nested paragraph. Nested blocks have their own translation jobs.
    const source = Array.from(host.childNodes).findLast((node) =>
      node.nodeType === Node.TEXT_NODE
        ? Boolean(node.textContent?.trim())
        : node instanceof HTMLElement &&
          !node.matches(blockTags + ',' + forbidden) &&
          Boolean(node.textContent?.trim()),
    );
    host.insertBefore(block.translation, source?.nextSibling ?? null);
  }
  block.translation.textContent = text;
  block.translation.style.marginTop = mode === 'translation' ? '0' : '0.3em';
  if (mode === 'translation') {
    if (!block.originals) {
      block.originals = [];
      const preserve = blockTags + ',' + forbidden + ',a[href]';
      const isPreserved = (node: Element) =>
        (node.matches(blockTags + ',' + forbidden) || isStandaloneLink(node)) &&
        !node.matches(blankInput);
      const hideProse = (parent: HTMLElement) => {
        let wrapper: HTMLElement | undefined;
        for (const node of Array.from(parent.childNodes)) {
          if (node instanceof Element && isPreserved(node)) {
            wrapper = undefined;
            continue;
          }
          if (
            node instanceof HTMLElement &&
            Array.from(node.querySelectorAll(preserve)).some(isPreserved)
          ) {
            wrapper = undefined;
            hideProse(node);
            continue;
          }
          if (!wrapper) {
            wrapper = document.createElement('span');
            wrapper.dataset.yijingOriginal = block.id;
            wrapper.hidden = true;
            wrapper.style.setProperty('display', 'none', 'important');
            wrapper.setAttribute('aria-hidden', 'true');
            parent.insertBefore(wrapper, node);
            block.originals!.push(wrapper);
          }
          wrapper.append(node);
        }
      };
      hideProse(block.element);
      block.original = block.originals[0];
    }
    const links = document.createElement('span');
    Object.assign(links.style, { display: 'block', fontSize: '0.85em', marginTop: '0.35em' });
    for (const original of (block.originals ?? []).flatMap((wrapper) =>
      Array.from(wrapper.querySelectorAll<HTMLAnchorElement>('a[href]')),
    )) {
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
  } else if (block.originals) {
    for (const original of block.originals) original.replaceWith(...original.childNodes);
    block.originals = undefined;
    block.original = undefined;
  }
}
export function restoreBlocks(blocks: Block[]) {
  for (const block of blocks) {
    block.translation?.remove();
    block.translation = undefined;
    if (block.originals) {
      for (const original of block.originals) original.replaceWith(...original.childNodes);
      block.originals = undefined;
      block.original = undefined;
    }
    for (const { element, originalStyle, appliedStyle, properties } of block.layout ?? []) {
      if (element.getAttribute('style') === appliedStyle) {
        if (originalStyle === null) element.removeAttribute('style');
        else element.setAttribute('style', originalStyle);
      } else {
        for (const { property, value, priority, applied } of properties) {
          if (
            element.style.getPropertyValue(property) !== applied ||
            element.style.getPropertyPriority(property) !== 'important'
          )
            continue;
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        }
        if (originalStyle === null && element.style.length === 0) element.removeAttribute('style');
      }
    }
    block.layout = undefined;
    block.element.hidden = block.originalHidden;
    if (block.originalAria === null) block.element.removeAttribute('aria-hidden');
    else block.element.setAttribute('aria-hidden', block.originalAria);
  }
}
