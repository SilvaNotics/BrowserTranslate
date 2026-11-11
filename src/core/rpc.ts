import type { Request, Response } from './types';
export const taskId = () => crypto.randomUUID();
export async function rpc<T>(message: Request): Promise<T> {
  const result: Response<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!result) throw new Error('扩展后台未响应，请重新加载扩展后刷新网页。');
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
export function isSupportedUrl(url = '') {
  return (
    /^https?:\/\//i.test(url) &&
    !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i.test(url) &&
    !/\.pdf(?:[?#]|$)/i.test(url)
  );
}
