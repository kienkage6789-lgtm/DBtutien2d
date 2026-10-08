import {
  ActPacket,
  BossesPacket,
  CombatLootPacket,
  CombatLootItem,
  DownPacket,
  HurtPacket,
  JoinPacket,
  KillPacket,
  LeavePacket,
  RevivedPacket,
  SkillResultPacket,
} from '../types.js';

type UnknownRecord = Record<string, unknown>;
export type WireId = string | number;

function recordOf(value: unknown): UnknownRecord | null {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function wireId(value: unknown): value is WireId {
  return (typeof value === 'string' && value.length > 0)
    || (typeof value === 'number' && Number.isFinite(value));
}

function optionalId(value: unknown): value is WireId | null | undefined {
  return value === undefined || value === null || wireId(value);
}

function finite(value: unknown, minimum = -Infinity): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum;
}

function optionalFinite(value: unknown, minimum = -Infinity): value is number | undefined {
  return value === undefined || finite(value, minimum);
}

function optionalBooleanLike(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean' || value === 0 || value === 1;
}

export function normalizeKillPacket(input: unknown): KillPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'kill' || !wireId(packet.id)) return null;
  if (!optionalFinite(packet.exp, 0) || !optionalId(packet.by)) return null;
  return {
    op: 'kill',
    id: packet.id,
    ...(packet.exp === undefined ? {} : { exp: packet.exp }),
    ...(packet.by === undefined ? {} : { by: packet.by }),
  };
}

export function normalizeSkillResultPacket(input: unknown): SkillResultPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'skill_res' || !finite(packet.n, 0) || !Number.isInteger(packet.n)) return null;
  return { op: 'skill_res', n: packet.n };
}

export function normalizeDownPacket(input: unknown): DownPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'down' || !optionalFinite(packet.left, 0) || !optionalFinite(packet.lostExp, 0)) return null;
  return {
    op: 'down',
    ...(packet.left === undefined ? {} : { left: packet.left }),
    ...(packet.lostExp === undefined ? {} : { lostExp: packet.lostExp }),
  };
}

export function normalizeHurtPacket(input: unknown): HurtPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'hurt' || !finite(packet.hp, 0) || !finite(packet.dmg, 0)) return null;
  if (!optionalFinite(packet.bp, 0) || !optionalFinite(packet.mp, 0) || !optionalFinite(packet.mpLoss, 0) || !optionalId(packet.byId)) return null;
  return {
    op: 'hurt',
    hp: packet.hp,
    dmg: packet.dmg,
    ...(packet.bp === undefined ? {} : { bp: packet.bp }),
    ...(packet.mp === undefined ? {} : { mp: packet.mp }),
    ...(packet.mpLoss === undefined ? {} : { mpLoss: packet.mpLoss }),
    ...(packet.byId === undefined ? {} : { byId: packet.byId }),
  };
}

function normalizePoints(value: unknown): Array<{ x: number; y: number }> | null {
  if (!Array.isArray(value)) return null;
  const points: Array<{ x: number; y: number }> = [];
  for (const point of value) {
    const row = recordOf(point);
    if (!row || !finite(row.x) || !finite(row.y)) return null;
    points.push({ x: row.x, y: row.y });
  }
  return points;
}

/** Normalize the discriminant and fields directly read by Gateway's act handler. */
export function normalizeActPacket(input: unknown): ActPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'act' || typeof packet.k !== 'string' || packet.k.length === 0) return null;
  const idFields = ['id', 't'] as const;
  for (const field of idFields) if (!optionalId(packet[field])) return null;
  for (const field of ['x', 'y', 'tx', 'ty', 'ax', 'ay', 'w', 'r', 'n', 'dps', 'ttl', 'bay'] as const) {
    if (!optionalFinite(packet[field])) return null;
  }
  if (!optionalBooleanLike(packet.flight)) return null;
  if (packet.mau !== undefined && typeof packet.mau !== 'string') return null;
  if (packet.result !== undefined && typeof packet.result !== 'string') return null;
  if (packet.pts !== undefined && normalizePoints(packet.pts) === null) return null;
  // `src` is forwarded by the official client but its element shape varies by action.
  if (packet.src !== undefined && !Array.isArray(packet.src)) return null;
  if (packet.targets !== undefined && !Array.isArray(packet.targets)) return null;
  return { ...packet, op: 'act', k: packet.k } as ActPacket;
}

function normalizeLootItem(input: unknown): CombatLootItem | null {
  const item = recordOf(input);
  if (!item || !wireId(item.id) || typeof item.item !== 'string' || item.item.length === 0) return null;
  if (!finite(item.x) || !finite(item.y)) return null;
  if (!optionalFinite(item.n, 0) || (item.n !== undefined && !Number.isInteger(item.n))) return null;
  if (!optionalFinite(item.khoa, 0) || (item.khoa !== undefined && !Number.isInteger(item.khoa))) return null;
  for (const field of ['vn', 'age', 'ox', 'oy'] as const) if (!optionalFinite(item[field])) return null;
  if (!optionalId(item.owner)) return null;
  if (!optionalBooleanLike(item.boss) || !optionalBooleanLike(item.daily) || !optionalBooleanLike(item.ht)) return null;
  if (item.bossName !== undefined && item.bossName !== null && typeof item.bossName !== 'string') return null;
  return item as CombatLootItem;
}

export function normalizeLootPacket(input: unknown): CombatLootPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'loot') return null;
  if (packet.l === undefined) return { op: 'loot' };
  if (!Array.isArray(packet.l)) return null;
  const items: CombatLootItem[] = [];
  for (const item of packet.l) {
    const normalized = normalizeLootItem(item);
    if (!normalized) return null;
    items.push(normalized);
  }
  return { op: 'loot', l: items };
}

export function normalizeLootGonePacket(input: unknown): { op: 'loot_gone'; id: WireId; by?: WireId | null } | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'loot_gone' || !wireId(packet.id) || !optionalId(packet.by)) return null;
  return { op: 'loot_gone', id: packet.id, ...(packet.by === undefined ? {} : { by: packet.by }) };
}

export function normalizeJoinPacket(input: unknown): JoinPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'join' || !wireId(packet.id)) return null;
  if (packet.name !== undefined && typeof packet.name !== 'string') return null;
  if (packet.realm !== undefined && typeof packet.realm !== 'string') return null;
  if (packet.phanThan !== undefined && typeof packet.phanThan !== 'boolean' && packet.phanThan !== 0 && packet.phanThan !== 1) return null;
  if (packet.pos !== undefined && !recordOf(packet.pos)) return null;
  return packet as JoinPacket;
}

export function normalizeLeavePacket(input: unknown): LeavePacket | null {
  const packet = recordOf(input);
  return packet && packet.op === 'leave' && wireId(packet.id) ? { op: 'leave', id: packet.id } : null;
}

export function normalizeBossesPacket(input: unknown): BossesPacket | null {
  const packet = recordOf(input);
  return packet && packet.op === 'bosses' && Array.isArray(packet.boards)
    ? { op: 'bosses', boards: packet.boards }
    : null;
}

export function normalizeRevivedPacket(input: unknown): RevivedPacket | null {
  const packet = recordOf(input);
  if (!packet || packet.op !== 'revived' || !finite(packet.hp, 0) || !finite(packet.mp, 0)) return null;
  if (!optionalFinite(packet.x) || !optionalFinite(packet.y) || !optionalFinite(packet.bp, 0) || !optionalFinite(packet.ep)) return null;
  return {
    op: 'revived',
    hp: packet.hp,
    mp: packet.mp,
    ...(packet.x === undefined ? {} : { x: packet.x }),
    ...(packet.y === undefined ? {} : { y: packet.y }),
    ...(packet.bp === undefined ? {} : { bp: packet.bp }),
    ...(packet.ep === undefined ? {} : { ep: packet.ep }),
  };
}

export type CombatPacket =
  | KillPacket
  | SkillResultPacket
  | DownPacket
  | HurtPacket
  | ActPacket
  | CombatLootPacket
  | { op: 'loot_gone'; id: WireId; by?: WireId | null }
  | JoinPacket
  | LeavePacket
  | BossesPacket
  | RevivedPacket;

export function normalizeCombatPacket(input: unknown): CombatPacket | null {
  const op = recordOf(input)?.op;
  switch (op) {
    case 'kill': return normalizeKillPacket(input);
    case 'skill_res': return normalizeSkillResultPacket(input);
    case 'down': return normalizeDownPacket(input);
    case 'hurt': return normalizeHurtPacket(input);
    case 'act': return normalizeActPacket(input);
    case 'loot': return normalizeLootPacket(input);
    case 'loot_gone': return normalizeLootGonePacket(input);
    case 'join': return normalizeJoinPacket(input);
    case 'leave': return normalizeLeavePacket(input);
    case 'bosses': return normalizeBossesPacket(input);
    case 'revived': return normalizeRevivedPacket(input);
    default: return null;
  }
}
