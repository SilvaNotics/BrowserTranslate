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
): Promise<boolean> {
  const code = codes[targetLanguage];
  if (!code) return false;
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  if (!letters.length) return false;
  const ratio = (script: RegExp) =>
    letters.filter((letter) => script.test(letter)).length / letters.length;
  if (code === 'zh') {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
    if (ratio(/\p{Script=Han}/u) < threshold) return false;
    const incompatible =
      targetLanguage === '简体中文' ? traditionalCharacters : simplifiedCharacters;
    if (letters.some((letter) => incompatible.has(letter))) return false;
    // Variant characters also occur in Japanese: they only reject incompatible text.
    // Positive identification of Han text still requires reliable language detection.
  }
  if (code === 'ja') {
    if (ratio(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u) < threshold) return false;
    if (ratio(/[\p{Script=Hiragana}\p{Script=Katakana}]/u) >= threshold) return true;
  } else if (code === 'ko') {
    if (ratio(/\p{Script=Hangul}/u) >= threshold) return true;
    if (ratio(/[\p{Script=Han}\p{Script=Hangul}]/u) < threshold) return false;
  } else if (code !== 'zh' && ratio(scripts[code]!) < threshold) return false;

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
