import { afterEach, expect, it, vi } from 'vitest';
import { PageController } from '../src/content/page-controller';
import type { Response, Segment } from '../src/core/types';
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
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
