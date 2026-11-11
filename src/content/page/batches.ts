import { PAGE_LIMITS } from '../../core/page';
import type { Segment } from '../../core/types';

export interface PageChunk extends Segment {
  visible: boolean;
}

export function splitText(text: string): string[] {
  const parts: string[] = [];
  let offset = 0;
  while (text.length - offset > PAGE_LIMITS.maxCharacters) {
    const window = text.slice(offset, offset + PAGE_LIMITS.maxCharacters);
    // Prefer sentence boundaries; fall back to words, then a Unicode-safe cut.
    const sentences = [...window.matchAll(/[.!?。！？；;](?:\s+|$)/g)];
    const words = [...window.matchAll(/\s+/g)];
    const boundary = sentences.at(-1) ?? words.at(-1);
    let length =
      boundary && boundary.index + boundary[0].length >= window.length / 2
        ? boundary.index + boundary[0].length
        : window.length;
    const last = window.charCodeAt(length - 1);
    if (last >= 0xd800 && last <= 0xdbff) length--;
    parts.push(text.slice(offset, offset + length));
    offset += length;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

export function takeBatch<T extends PageChunk>(queue: T[]): T[] {
  const batch: T[] = [];
  let size = 0;
  while (queue.length && batch.length < PAGE_LIMITS.maxSegments) {
    const next = queue[0]!;
    if (batch.length && next.visible !== batch[0]!.visible) break;
    if (size + next.text.length > PAGE_LIMITS.maxCharacters) break;
    batch.push(queue.shift()!);
    size += next.text.length;
  }
  return batch;
}
