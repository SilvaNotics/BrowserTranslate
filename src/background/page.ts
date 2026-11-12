import { complete, parseBatch, translationPrompt } from '../core/model';
import { PAGE_LIMITS } from '../core/page';
import { resolveModel } from '../core/settings';
import type { Segment, Settings } from '../core/types';
import { isMostlyTargetLanguage } from '../core/language';

export async function translatePageBatch(
  settings: Settings,
  segments: Segment[],
  signal: AbortSignal,
): Promise<Segment[]> {
  if (!settings.features.page) throw new Error('整页翻译已关闭。');
  if (
    !Array.isArray(segments) ||
    !segments.length ||
    segments.length > PAGE_LIMITS.maxSegments ||
    segments.some(
      (s) =>
        !s ||
        typeof s.id !== 'string' ||
        !s.id ||
        s.id.length > 100 ||
        typeof s.text !== 'string' ||
        (s.language !== undefined && (typeof s.language !== 'string' || s.language.length > 100)) ||
        !s.text.trim() ||
        s.text.length > PAGE_LIMITS.maxCharacters,
    ) ||
    segments.reduce((size, s) => size + s.text.length, 0) > PAGE_LIMITS.maxCharacters ||
    new Set(segments.map((s) => s.id)).size !== segments.length
  )
    throw new Error('翻译批次过大或格式不正确。');

  signal.throwIfAborted();
  const detected = await Promise.all(
    segments.map(async (segment) => ({
      ...segment,
      skipped: await isMostlyTargetLanguage(
        segment.text,
        settings.targetLanguage,
        segment.language,
      ),
    })),
  );
  signal.throwIfAborted();
  const skipped = detected.filter((s) => s.skipped);
  const pending = detected.filter((s) => !s.skipped);
  if (!pending.length) return skipped;
  // DOM/task UUIDs stay local; the model only needs small batch-relative IDs.
  const input = pending.map(({ text }, index) => ({ id: String(index), text }));
  const { provider, model } = resolveModel(settings, 'translation');
  const raw = await complete(
    provider,
    model,
    translationPrompt(settings.targetLanguage) +
      ' 输入为JSON数组，每项包含id和text。只返回JSON数组，保留每项id，将text替换为译文，不增删项目。',
    JSON.stringify(input),
    signal,
  );
  return [
    ...skipped,
    ...parseBatch(
      raw,
      input.map((s) => s.id),
    ).map((s) => ({
      id: pending[Number(s.id)]!.id,
      text: s.text,
    })),
  ];
}
