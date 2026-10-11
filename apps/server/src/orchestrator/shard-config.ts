export function boundedEnvInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const text = value?.trim();
  if (!text || !/^-?\d+$/.test(text)) return fallback;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
