/**
 * The official client owns automation now.  Keep only the small compatibility
 * envelope needed to read old database files; unknown legacy fields are never
 * written back.
 */
export interface BotConfig {
  engine: 'vendor';
  pref?: Record<string, unknown>;
}

export const DEFAULT_BOT_CONFIG: BotConfig = { engine: 'vendor' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function normalizeBotConfig(value: unknown): BotConfig {
  if (!isRecord(value)) return { ...DEFAULT_BOT_CONFIG };
  const pref = isRecord(value.pref) ? { ...value.pref } : undefined;
  return pref ? { ...DEFAULT_BOT_CONFIG, pref } : { ...DEFAULT_BOT_CONFIG };
}

