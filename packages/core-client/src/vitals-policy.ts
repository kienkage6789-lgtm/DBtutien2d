/**
 * Shared vitals display/gate policy.
 *
 * The 5s/30s/30s values are proposed operational thresholds, not live-game
 * protocol facts. Keep them named so later live measurements can change the
 * policy without changing VitalSnapshot semantics.
 */
export const VITALS_DISPLAY_STALE_MS = 5_000;
export const VITALS_ATTACK_MAX_AGE_MS = 30_000;
export const VITALS_REFRESH_MIN_INTERVAL_MS = 30_000;
