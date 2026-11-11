import { createWorker, OEM, type Worker } from 'tesseract.js';

let active: { id: string; cancel: () => void } | undefined;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id) return false;
  if (message.type === 'ocr:cancel') {
    if (active && active.id === message.id) active.cancel();
    respond({ ok: true });
    return false;
  }
  if (message.type !== 'ocr:run') return false;
  if (active) {
    respond({ ok: false, error: '已有截图正在识别，请稍后重试。' });
    return false;
  }
  const controller = new AbortController();
  const job = { id: message.id as string, cancel: () => controller.abort() };
  active = job;
  const heartbeat = setInterval(() => {
    void chrome.runtime.sendMessage({ type: 'ocr:heartbeat' });
  }, 20000);
  const timeout = setTimeout(job.cancel, 90000);
  let worker: Worker | undefined;
  let rejectCancelled: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = () => reject(new Error('任务已取消或识别超时。'));
    controller.signal.addEventListener('abort', rejectCancelled, { once: true });
  });
  void (async () => {
    try {
      const initializing = createWorker(['eng', 'chi_sim'], OEM.LSTM_ONLY, {
        workerPath: chrome.runtime.getURL('ocr/worker.min.js'),
        corePath: chrome.runtime.getURL('ocr/core/'),
        langPath: chrome.runtime.getURL('ocr/lang/'),
        workerBlobURL: false,
        gzip: true,
        errorHandler: () => {},
      }).then(async (instance) => {
        if (controller.signal.aborted) {
          await instance.terminate();
          throw new Error('任务已取消。');
        }
        worker = instance;
        return instance;
      });
      const instance = await Promise.race([initializing, cancelled]);
      const result = await Promise.race([instance.recognize(message.image), cancelled]);
      respond({ ok: true, text: result.data.text.trim() });
    } catch {
      respond({ ok: false, error: '本地识别失败、超时或已取消，请重新框选，或切换视觉模型。' });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (rejectCancelled) controller.signal.removeEventListener('abort', rejectCancelled);
      await worker?.terminate().catch(() => {});
      if (active === job) active = undefined;
    }
  })();
  return true;
});
