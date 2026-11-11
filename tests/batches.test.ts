import { expect, it } from 'vitest';
import { splitText, takeBatch } from '../src/content/page/batches';

it('长段落优先按句子拆开，拼回原文不丢字且不切断 Unicode 字符', () => {
  const text = 'x'.repeat(3999) + '😀' + 'Second sentence. '.repeat(400);
  const parts = splitText(text);
  expect(parts.join('')).toBe(text);
  expect(parts.every((part) => part.length <= 4000 && part.isWellFormed())).toBe(true);
  const sentences = splitText('A sentence. '.repeat(500));
  expect(sentences.slice(0, -1).every((part) => part.endsWith('. '))).toBe(true);
});

it('每批限制总字符数与段落数，可视内容单独组批以便优先显示', () => {
  const queue = [
    { id: 'a', text: 'First visible', visible: true },
    { id: 'b', text: 'Second visible', visible: true },
    { id: 'c', text: 'Outside viewport', visible: false },
  ];
  expect(takeBatch(queue).map((s) => s.id)).toEqual(['a', 'b']);
  expect(queue.map((s) => s.id)).toEqual(['c']);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), text: 'x', visible: true }));
  expect(takeBatch(many)).toHaveLength(24);
  const large = Array.from({ length: 3 }, (_, i) => ({
    id: String(i),
    text: 'x'.repeat(1800),
    visible: true,
  }));
  expect(takeBatch(large)).toHaveLength(2);
});
