// Shared by the content scheduler and the background request validator.
export const PAGE_LIMITS = {
  defaultConcurrency: 4,
  maxConcurrency: 6,
  maxSegments: 24,
  maxCharacters: 4000,
  cacheEntries: 300,
} as const;

export function validPageConcurrency(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 1 && Number(value) <= PAGE_LIMITS.maxConcurrency
  );
}
