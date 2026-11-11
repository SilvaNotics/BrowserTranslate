import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Source } from './types';
export function parseSources(raw: string): Source[] {
  const output: Source[] = [];
  const seen = new Set<string>();
  const entries = raw.split(/(?=^Title:)/m);
  for (const entry of entries) {
    const urlMatch = entry.match(/^URL:\s*(https?:\/\/\S+)/m);
    const titleMatch = entry.match(/^Title:\s*(.+)/m);
    if (!urlMatch?.[1]) continue;
    const url = urlMatch[1].replace(/[)>]+$/, '');
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || seen.has(u.href))
        continue;
      seen.add(u.href);
    } catch {
      continue;
    }
    output.push({
      id: output.length + 1,
      title: titleMatch?.[1]?.trim() || new URL(url).hostname,
      url,
      text: entry.slice(0, 5000),
    });
    if (output.length === 5) break;
  }
  return output;
}
export function sanitizeCitations(text: string, sources: Source[]) {
  return text.replace(/\[(\d+)\]/g, (match, n: string) =>
    sources.some((s) => s.id === Number(n)) ? match : '',
  );
}
function toolText(result: unknown): string {
  const data = result as { isError?: boolean; content?: { type: string; text?: string }[] };
  if (data.isError) throw new Error('搜索服务限流或暂不可用');
  return (data.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}
export async function searchExa(
  text: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Source[]> {
  const client = new Client({ name: 'BrowserTranslate', version: '0.1.1' });
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.exa.ai/mcp'), {
    requestInit: { headers: apiKey ? { 'x-api-key': apiKey } : {}, credentials: 'omit' },
  });
  try {
    await client.connect(transport, { timeout: 10000, signal });
    const raw = toolText(
      await client.callTool(
        {
          name: 'web_search_exa',
          arguments: {
            query: text.replace(/\s+/g, ' ').slice(0, 240) + ' meaning usage explanation',
            numResults: 5,
            objective:
              'Find authoritative dictionary or reference pages that explain the quoted expression, its meaning and usage. Prefer primary reference sources; exclude advertising and unsupported claims.',
          },
        },
        undefined,
        { timeout: 12000, signal },
      ),
    );
    const sources = parseSources(raw);
    if (!sources.length) throw new Error('未找到可引用的搜索结果');
    try {
      const full = toolText(
        await client.callTool(
          {
            name: 'web_fetch_exa',
            arguments: { urls: sources.slice(0, 2).map((s) => s.url), maxCharacters: 5000 },
          },
          undefined,
          { timeout: 8000, signal },
        ),
      );
      for (const source of sources.slice(0, 2)) {
        const start = full.indexOf(source.url);
        if (start >= 0) source.text += '\n' + full.slice(start, start + 5000);
      }
    } catch {
      /* Search excerpts remain usable when full-page fetching fails. */
    }
    return sources;
  } finally {
    await client.close().catch(() => {});
  }
}
