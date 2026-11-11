import { afterEach, expect, it, vi } from 'vitest';
import { isMostlyTargetLanguage } from '../src/core/language';

afterEach(() => vi.unstubAllGlobals());

it('含简繁特征字的日文标题也不能直接判定为中文', async () => {
  for (const [text, target] of [
    ['本日休業', '繁體中文'],
    ['受付終了', '繁體中文'],
    ['出張', '繁體中文'],
    ['台本', '简体中文'],
    ['国民休暇', '简体中文'],
  ]) {
    expect(await isMostlyTargetLanguage(text!, target!), `${text} → ${target}`).toBe(false);
  }
});

it('中文占文字至少 85% 时跳过，数字和标点不影响判断，少量 API 名称可保留', async () => {
  vi.stubGlobal('chrome', {
    i18n: {
      detectLanguage: async () => ({
        isReliable: true,
        languages: [{ language: 'zh', percentage: 98 }],
      }),
    },
  });
  expect(
    await isMostlyTargetLanguage(
      '这段文字几乎完全使用中文编写，只包含一个 API 名称以及 2026 年份。',
      '简体中文',
    ),
  ).toBe(true);
  expect(await isMostlyTargetLanguage('设置', '简体中文')).toBe(false);
  expect(
    await isMostlyTargetLanguage('Read this English paragraph with 中文 terms.', '简体中文'),
  ).toBe(false);
  expect(
    await isMostlyTargetLanguage('请阅读 This is a long English explanation.', '简体中文'),
  ).toBe(false);
  expect(await isMostlyTargetLanguage('これは日本語の文章です。', '简体中文')).toBe(false);
});

it('简繁转换和无法确定的短文本仍翻译，不把所有拉丁字母都当成英语', async () => {
  expect(await isMostlyTargetLanguage('這個網頁需要轉換為簡體中文。', '简体中文')).toBe(false);
  expect(await isMostlyTargetLanguage('这个网页需要转换为繁体中文。', '繁體中文')).toBe(false);
  const detectLanguage = vi.fn(async () => ({
    isReliable: true,
    languages: [
      { language: 'fr', percentage: 99 },
      { language: 'en', percentage: 1 },
    ],
  }));
  vi.stubGlobal('chrome', { i18n: { detectLanguage } });
  expect(
    await isMostlyTargetLanguage(
      'La traduction de cette page est entièrement en français.',
      'English',
    ),
  ).toBe(false);
  detectLanguage.mockResolvedValue({
    isReliable: true,
    languages: [{ language: 'en', percentage: 98 }],
  });
  expect(
    await isMostlyTargetLanguage(
      'This paragraph is already written in the target language.',
      'English',
    ),
  ).toBe(true);
  detectLanguage.mockResolvedValue({
    isReliable: false,
    languages: [{ language: 'en', percentage: 99 }],
  });
  expect(await isMostlyTargetLanguage('A short ambiguous name', 'English')).toBe(false);
});

it('本地语言检测不可用或失败时继续翻译，不产生未处理错误', async () => {
  vi.stubGlobal('chrome', {
    i18n: {
      detectLanguage: async () => {
        throw new Error('detector unavailable');
      },
    },
  });
  expect(
    await isMostlyTargetLanguage('This paragraph should still be translated.', 'English'),
  ).toBe(false);
});

it('中文里引用一个日文或韩文字母不会被当成整段日文或韩文', async () => {
  expect(
    await isMostlyTargetLanguage('这段文字完全都是中文，只是在最后引用一个日本字母あ', '日本語'),
  ).toBe(false);
  expect(
    await isMostlyTargetLanguage('这段文字完全都是中文，只是在最后引用一个韩国字母한', '한국어'),
  ).toBe(false);
  expect(await isMostlyTargetLanguage('香港龍鳳餐廳', '简体中文')).toBe(false);
  expect(await isMostlyTargetLanguage('香港龙凤餐厅', '繁體中文')).toBe(false);
  expect(await isMostlyTargetLanguage('本日休業', '简体中文')).toBe(false);
  expect(await isMostlyTargetLanguage('受付終了', '简体中文')).toBe(false);
});
