import { afterEach, expect, it, vi } from 'vitest';
import { PageController } from '../src/content/page/controller';
import type { Response, Segment } from '../src/core/types';
import * as dom from '../src/content/page/dom';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
it('导航内联链接的文字更新后重新翻译原来的段落宿主', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<nav><span><a href="#inbox">Inbox (1)</a></span></nav>';
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (message: { type: string; segments: Segment[] }) =>
        Promise.resolve({
          ok: true,
          data:
            message.type === 'page:batch'
              ? message.segments.map((s) => ({ ...s, text: '译文：' + s.text }))
              : true,
        }),
    },
  });
  const controller = new PageController(() => {});
  try {
    controller.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('[data-yijing-translation]')?.textContent).toBe(
      '译文：Inbox (1)',
    );
    document.querySelector('a')!.textContent = 'Inbox (2)';
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('[data-yijing-translation]')?.textContent).toBe(
      '译文：Inbox (2)',
    );
    expect(controller.state).toMatchObject({ done: 1, total: 1 });
  } finally {
    controller.restore();
  }
});
it('动态更新只扫描变化的子树，不重新读取无关段落', async () => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<main>' +
    Array.from({ length: 200 }, (_, i) => `<p>Stable paragraph ${i}</p>`).join('') +
    '</main><section id="feed"></section>';
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (message: { type: string; segments: Segment[] }) =>
        Promise.resolve({
          ok: true,
          data:
            message.type === 'page:batch'
              ? message.segments.map((s) => ({ ...s, text: '译文：' + s.text }))
              : true,
        }),
    },
  });
  const collect = vi.spyOn(dom, 'collectBlocks');
  const read = vi.spyOn(dom, 'readBlockText');
  const controller = new PageController(() => {});
  try {
    controller.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(controller.state.done).toBe(200);
    collect.mockClear();
    read.mockClear();
    document.querySelector('#feed')!.insertAdjacentHTML('beforeend', '<p>New live paragraph</p>');
    await vi.advanceTimersByTimeAsync(300);
    expect(controller.state.done).toBe(201);
    expect(collect.mock.calls.map(([root]) => root.tagName)).not.toContain('BODY');
    expect(read.mock.calls.filter(([element]) => element.closest('main'))).toHaveLength(0);
  } finally {
    controller.restore();
  }
});
it('持续追加内容不会无限推迟翻译', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<section></section>';
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (message: { type: string; segments: Segment[] }) =>
        Promise.resolve({
          ok: true,
          data:
            message.type === 'page:batch'
              ? message.segments.map((s) => ({ ...s, text: '译文：' + s.text }))
              : true,
        }),
    },
  });
  const controller = new PageController(() => {});
  try {
    controller.start();
    for (let i = 0; i < 8; i++) {
      document.querySelector('section')!.insertAdjacentHTML('beforeend', `<p>Live update ${i}</p>`);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(controller.state.done).toBeGreaterThan(0);
  } finally {
    controller.restore();
  }
});
it('55 个短段落只发 3 个请求，一轮并发内完成', async () => {
  vi.useFakeTimers();
  let requests = 0;
  document.body.innerHTML = Array.from(
    { length: 55 },
    (_, i) => `<p>Technical paragraph ${i} about socket programming.</p>`,
  ).join('');
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) => {
        if (m.type !== 'page:batch') return Promise.resolve({ ok: true, data: true });
        requests++;
        expect(m.segments.length).toBeLessThanOrEqual(24);
        expect(
          m.segments.reduce((size, segment) => size + segment.text.length, 0),
        ).toBeLessThanOrEqual(4000);
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                data: m.segments.map((segment) => ({ ...segment, text: '译文：' + segment.text })),
              }),
            100,
          ),
        );
      },
    },
  });
  const controller = new PageController(() => {});
  try {
    controller.start('translation');
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.state).toMatchObject({ done: 55, total: 55, failed: 0 });
    expect(requests).toBe(3);
    expect(document.querySelectorAll('[data-yijing-translation]')).toHaveLength(55);
  } finally {
    controller.restore();
  }
});
it('虚拟列表复用原节点时更新译文，原节点移除后清除残留译文', async () => {
  document.body.innerHTML = '<p>First revision</p>';
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { segments: Segment[] }) =>
        Promise.resolve({
          ok: true,
          data: m.segments.map((s) => ({ ...s, text: '译文：' + s.text })),
        }),
    },
  });
  const controller = new PageController(() => {});
  controller.start();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-yijing-translation]')?.textContent).toContain(
      'First revision',
    ),
  );
  document.querySelector('p')!.textContent = 'Second revision';
  await vi.waitFor(
    () =>
      expect(document.querySelector('[data-yijing-translation]')?.textContent).toContain(
        'Second revision',
      ),
    { timeout: 1500 },
  );
  document.querySelector('p')!.remove();
  await vi.waitFor(() => expect(document.querySelector('[data-yijing-translation]')).toBeNull(), {
    timeout: 1500,
  });
  controller.restore();
});
it('停止后继续不会丢掉尚未完成的段落，恢复取消任务并移除译文', async () => {
  document.body.innerHTML = '<p>First paragraph</p><p>Second paragraph</p>';
  const batches: { segments: Segment[]; finish: (response: Response<Segment[]>) => void }[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) =>
        m.type === 'page:batch'
          ? new Promise((resolve) => {
              batches.push({ segments: m.segments, finish: resolve });
            })
          : Promise.resolve({ ok: true, data: true }),
    },
  });
  const controller = new PageController(() => {});
  controller.start();
  expect(batches).toHaveLength(1);
  controller.stop();
  controller.start();
  expect(batches).toHaveLength(2);
  batches[1]!.finish({ ok: true, data: batches[1]!.segments.map((s) => ({ ...s, text: '译文' })) });
  await vi.waitFor(() => expect(controller.state.done).toBe(2));
  batches[0]!.finish({ ok: true, data: batches[0]!.segments.map((s) => ({ ...s, text: '过期' })) });
  await Promise.resolve();
  expect(document.body.textContent).not.toContain('过期');
  controller.restore();
  expect(document.querySelectorAll('[data-yijing-translation]')).toHaveLength(0);
});
it('批次失败保留原文，并允许重试', async () => {
  document.body.innerHTML = '<p>Keep original paragraph</p>';
  let failed = true;
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) =>
        Promise.resolve(
          failed
            ? { ok: false, error: '请求限流' }
            : { ok: true, data: m.segments.map((s) => ({ ...s, text: '重试成功' })) },
        ),
    },
  });
  const controller = new PageController(() => {});
  controller.start();
  await vi.waitFor(() => expect(controller.state.failed).toBe(1));
  expect(document.querySelector('p')!.hidden).toBe(false);
  failed = false;
  controller.retry();
  await vi.waitFor(() => expect(controller.state.done).toBe(1));
  expect(controller.state.failed).toBe(0);
  controller.restore();
});

it('按设置并发分块，完成一批立即补位且乱序响应不串段', async () => {
  document.body.innerHTML = Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i}</p>`).join('');
  const batches: { segments: Segment[]; finish: (response: Response<Segment[]>) => void }[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) =>
        m.type === 'page:batch'
          ? new Promise((resolve) => batches.push({ segments: m.segments, finish: resolve }))
          : Promise.resolve({ ok: true, data: true }),
    },
  });
  const controller = new PageController(() => {});
  controller.configure({ concurrency: 2, context: 'fixture' });
  try {
    controller.start();
    expect(batches).toHaveLength(2);
    expect(batches[0]!.segments).toHaveLength(24);
    batches[1]!.finish({
      ok: true,
      data: [...batches[1]!.segments].reverse().map((s) => ({ ...s, text: '译文：' + s.text })),
    });
    await vi.waitFor(() => expect(batches).toHaveLength(3));
    expect(controller.state.done).toBe(24);
    for (const index of [0, 2, 3]) {
      const batch = batches[index]!;
      batch.finish({
        ok: true,
        data: batch.segments.map((s) => ({ ...s, text: '译文：' + s.text })),
      });
      await Promise.resolve();
      await Promise.resolve();
    }
    await vi.waitFor(() => expect(controller.state.done).toBe(80));
    for (const [index, p] of Array.from(document.querySelectorAll('p')).entries()) {
      expect(p.querySelector('[data-yijing-translation]')?.textContent).toBe(
        '译文：Paragraph ' + index,
      );
    }
  } finally {
    controller.restore();
  }
});

it('重复文字只请求一次，恢复后复用缓存，切换模型或语言清空缓存', async () => {
  document.body.innerHTML = '<p>Repeated paragraph</p>'.repeat(55);
  let requests = 0;
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) => {
        if (m.type !== 'page:batch') return Promise.resolve({ ok: true, data: true });
        requests++;
        expect(m.segments).toHaveLength(1);
        return Promise.resolve({
          ok: true,
          data: m.segments.map((s) => ({ ...s, text: '重复译文' })),
        });
      },
    },
  });
  const controller = new PageController(() => {});
  controller.configure({ concurrency: 4, context: 'model-a:zh' });
  try {
    controller.start();
    await vi.waitFor(() => expect(controller.state.done).toBe(55));
    expect(requests).toBe(1);
    controller.restore();
    controller.start();
    expect(controller.state.done).toBe(55);
    expect(requests).toBe(1);
    controller.configure({ concurrency: 4, context: 'model-b:ja' });
    expect(document.querySelector('[data-yijing-translation]')).toBeNull();
    controller.start();
    await vi.waitFor(() => expect(controller.state.done).toBe(55));
    expect(requests).toBe(2);
  } finally {
    controller.restore();
  }
});

it('超长段落分块并发，失败只重试缺失块，完整后按原顺序合并', async () => {
  const text = Array.from({ length: 600 }, (_, i) => `Sentence number ${i}. `).join('');
  document.body.innerHTML = '<p></p>';
  document.querySelector('p')!.textContent = text;
  const batches: { segments: Segment[]; finish: (response: Response<Segment[]>) => void }[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) =>
        m.type === 'page:batch'
          ? new Promise((resolve) => batches.push({ segments: m.segments, finish: resolve }))
          : Promise.resolve({ ok: true, data: true }),
    },
  });
  const controller = new PageController(() => {});
  try {
    controller.start();
    expect(batches.length).toBeGreaterThan(1);
    const segments = batches.flatMap((b) => b.segments);
    expect(segments.every((s) => s.text.length <= 4000)).toBe(true);
    expect(segments.map((s) => s.text).join('')).toBe(text.trim());
    for (const batch of [...batches.slice(1)].reverse()) {
      batch.finish({ ok: true, data: batch.segments.map((s) => ({ ...s, text: '后半译文' })) });
    }
    batches[0]!.finish({ ok: false, error: '请求限流' });
    await vi.waitFor(() => expect(controller.state.failed).toBe(1));
    expect(controller.state.done).toBe(0);
    expect(document.querySelector('[data-yijing-translation]')).toBeNull();
    const before = batches.length;
    controller.retry();
    expect(batches).toHaveLength(before + 1);
    expect(batches.at(-1)!.segments).toEqual(batches[0]!.segments);
    batches
      .at(-1)!
      .finish({ ok: true, data: batches[0]!.segments.map((s) => ({ ...s, text: '首块译文' })) });
    await vi.waitFor(() => expect(controller.state.done).toBe(1));
    expect(document.querySelector('[data-yijing-translation]')?.textContent).toMatch(
      /^首块译文\n后半译文/,
    );
    expect(controller.state.failed).toBe(0);
  } finally {
    controller.restore();
  }
});

it('跳过目标语言的段落计入完成进度，保留原文且不插入重复译文', async () => {
  document.body.innerHTML = '<p>这个段落已经是中文。</p>';
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) =>
        Promise.resolve({
          ok: true,
          data: m.type === 'page:batch' ? m.segments.map((s) => ({ ...s, skipped: true })) : true,
        }),
    },
  });
  const controller = new PageController(() => {});
  try {
    controller.start('translation');
    await vi.waitFor(() =>
      expect(controller.state).toMatchObject({ done: 1, skipped: 1, total: 1 }),
    );
    expect(document.querySelector('[data-yijing-translation]')).toBeNull();
    expect(document.querySelector('p')?.textContent).toBe('这个段落已经是中文。');
    controller.mode('bilingual');
    expect(document.querySelector('[data-yijing-translation]')).toBeNull();
  } finally {
    controller.restore();
  }
});

it.each(['remove', 'edit'] as const)('并发槽释放时不发送已经 %s 的旧段落', async (change) => {
  document.body.innerHTML = Array.from({ length: 50 }, (_, i) => `<p>Paragraph ${i}</p>`).join('');
  const batches: { segments: Segment[]; finish: (response: Response<Segment[]>) => void }[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) =>
        m.type === 'page:batch'
          ? new Promise((resolve) => batches.push({ segments: m.segments, finish: resolve }))
          : Promise.resolve({ ok: true, data: true }),
    },
  });
  const controller = new PageController(() => {});
  controller.configure({ concurrency: 1, context: 'fixture' });
  try {
    controller.start();
    const queued = Array.from(document.querySelectorAll('p')).slice(24);
    for (const p of queued) {
      if (change === 'remove') p.remove();
      else p.textContent = 'Changed ' + p.textContent;
    }
    batches[0]!.finish({
      ok: true,
      data: batches[0]!.segments.map((s) => ({ ...s, text: '译文' })),
    });
    await Promise.resolve();
    await Promise.resolve();
    if (change === 'remove') expect(batches).toHaveLength(1);
    else {
      expect(batches).toHaveLength(2);
      expect(batches[1]!.segments.every((s) => s.text.startsWith('Changed '))).toBe(true);
    }
  } finally {
    controller.restore();
  }
});

it.each(['fail', 'stop'] as const)('孤立任务 %s 后，同样文字重新出现会重新请求', async (action) => {
  vi.useFakeTimers();
  document.body.innerHTML = '<p>Returning paragraph</p>';
  const batches: { segments: Segment[]; finish: (response: Response<Segment[]>) => void }[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: (m: { type: string; segments: Segment[] }) =>
        m.type === 'page:batch'
          ? new Promise((resolve) => batches.push({ segments: m.segments, finish: resolve }))
          : Promise.resolve({ ok: true, data: true }),
    },
  });
  const controller = new PageController(() => {});
  try {
    controller.start();
    document.querySelector('p')!.remove();
    await vi.advanceTimersByTimeAsync(150);
    if (action === 'fail') {
      batches[0]!.finish({ ok: false, error: '请求失败' });
      await vi.advanceTimersByTimeAsync(0);
    } else {
      controller.stop();
      controller.start();
    }
    document.body.insertAdjacentHTML('beforeend', '<p>Returning paragraph</p>');
    await vi.advanceTimersByTimeAsync(150);
    expect(batches).toHaveLength(2);
    batches[1]!.finish({
      ok: true,
      data: batches[1]!.segments.map((s) => ({ ...s, text: '重新翻译成功' })),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.state).toMatchObject({ done: 1, total: 1, failed: 0 });
  } finally {
    controller.restore();
  }
});
