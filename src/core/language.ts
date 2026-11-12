import { simplifiedCharacters, traditionalCharacters } from './data/opencc/characters';

const threshold = 0.85;
const codes: Record<string, string> = {
  简体中文: 'zh',
  繁體中文: 'zh',
  English: 'en',
  日本語: 'ja',
  한국어: 'ko',
  Français: 'fr',
  Deutsch: 'de',
  Español: 'es',
  Русский: 'ru',
  Português: 'pt',
  العربية: 'ar',
};
const scripts: Record<string, RegExp> = {
  en: /\p{Script=Latin}/u,
  fr: /\p{Script=Latin}/u,
  de: /\p{Script=Latin}/u,
  es: /\p{Script=Latin}/u,
  pt: /\p{Script=Latin}/u,
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
};

export async function isMostlyTargetLanguage(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<boolean> {
  const code = codes[targetLanguage];
  if (!code) return false;
  const source = sourceLanguage?.toLowerCase().split('-')[0];
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  if (!letters.length) return false;
  const ratio = (script: RegExp) =>
    letters.filter((letter) => script.test(letter)).length / letters.length;
  if (code === 'zh') {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
    const han = letters.filter((letter) => /\p{Script=Han}/u.test(letter)).length;
    const latinWords = text.match(/\p{Script=Latin}+/gu) ?? [];
    // In declared Chinese prose, count a few embedded names/acronyms as words,
    // so "Claude" doesn't outweigh several Chinese characters in a video title.
    const chineseWithNames =
      source === 'zh' &&
      han >= 4 &&
      latinWords.length <= 3 &&
      letters.every((letter) => /[\p{Script=Han}\p{Script=Latin}]/u.test(letter)) &&
      han / (han + latinWords.length) >= 0.8;
    if (han / letters.length < threshold && !chineseWithNames) return false;
    const incompatible =
      targetLanguage === '简体中文' ? traditionalCharacters : simplifiedCharacters;
    if (letters.some((letter) => incompatible.has(letter))) return false;
    // Han-only links are often too short for CLD. Use the nearest declared language,
    // but only after checking the script and the requested Chinese variant.
    if (source === 'zh') return true;
    if (source === 'ja' || source === 'ko') return false;
  }
  if (code === 'ja') {
    if (ratio(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u) < threshold) return false;
    if (ratio(/[\p{Script=Hiragana}\p{Script=Katakana}]/u) >= threshold) return true;
  } else if (code === 'ko') {
    if (ratio(/\p{Script=Hangul}/u) >= threshold) return true;
    if (ratio(/[\p{Script=Han}\p{Script=Hangul}]/u) < threshold) return false;
  } else if (code !== 'zh' && ratio(scripts[code]!) < threshold) return false;
  if (source === code) return true;

  // Chrome's bundled CLD distinguishes languages sharing a script without a model call.
  // https://developer.chrome.com/docs/extensions/reference/api/i18n#method-detectLanguage
  if (letters.length < 12) return false;
  try {
    const result = await chrome.i18n.detectLanguage(text);
    return (
      result.isReliable &&
      result.languages.some(
        (language) =>
          language.language.toLowerCase().split('-')[0] === code &&
          language.percentage >= threshold * 100,
      )
    );
  } catch {
    // Uncertain detection must never silently discard text needing translation.
    return false;
  }
}
