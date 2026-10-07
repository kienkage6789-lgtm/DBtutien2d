import fs from 'node:fs';
import path from 'node:path';

interface ArrayShape { packets: number; rows: number; keys: Set<string>; idTypes: Set<string> }
type RedactedScalar = number | string | boolean | null;
type RedactedNumber = number | boolean | null;

const NUMERIC_KEYS = ['hp', 'maxHp', 'mp', 'maxMp', 'sp', 'bp', 'dn', 'seq', 'fix', 'ep', 'left', 'lostExp'] as const;
const YOU_KEYS = ['seq', 'hp', 'mp', 'sp', 'bp', 'dn', 'fix'] as const;
const REDACTED_STRUCTURAL_KEYS = new Set(['selfId']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const redactedScalar = (value: unknown): RedactedScalar => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const redactedNumber = (value: unknown): RedactedNumber => {
  if (value === null || typeof value === 'boolean') return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const redactedItemId = (value: unknown): RedactedScalar => {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (!isRecord(value)) return null;
  return redactedScalar(value.id ?? value.itemId);
};

const redactedRealm = (value: unknown): RedactedScalar =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;

/** Opt-in packet diagnostics. Raw packets, identifiers, names, and tokens are never persisted. */
export class PacketTap {
  private readonly startedAt = Date.now();
  private readonly ops = new Map<string, number>();
  private readonly opKeys = new Map<string, Set<string>>();
  private readonly firstPackets: Array<{ at: number; op: string }> = [];
  private readonly arrays = new Map<string, ArrayShape>();
  private readonly vitalPackets: Array<Record<string, unknown>> = [];
  private readonly selfEntries: Array<Record<string, unknown>> = [];
  private readonly numericFields: Array<{ at: number; op: string; fields: Record<string, RedactedNumber> }> = [];
  private readonly statePackets: Array<{
    at: number;
    keys: string[];
    saveKeys: string[];
    equipment: Array<{ slot: string; id: RedactedScalar }>;
    realm: RedactedScalar;
    saveRealm: RedactedScalar;
  }> = [];
  private readonly youPackets: Array<Record<string, RedactedNumber>> = [];
  private readonly outboundMoves: Array<{
    at: number;
    seq: number | null;
    x: number | null;
    y: number | null;
    st: string | null;
    ep: RedactedNumber;
  }> = [];
  private readonly stationaryProbeBatches: Array<{
    label: string;
    atStart: number;
    atEnd: number;
    seqStart: number | null;
    seqEnd: number | null;
    st: string | null;
    x: number | null;
    y: number | null;
    movesSent: number;
    youCount: number;
    positionBefore: { x: number | null; y: number | null };
    positionAfter: { x: number | null; y: number | null };
  }> = [];
  private readonly stationaryProbeYou: Array<Record<string, RedactedNumber | string>> = [];
  private readonly stationaryProbeCancellations: Array<{ at: number; reason: string }> = [];
  private activeStationaryProbeBatch: {
    label: string;
    atStart: number;
    outboundStartIndex: number;
    st: string | null;
    x: number | null;
    y: number | null;
    positionBefore: { x: number | null; y: number | null };
  } | null = null;
  private lastOutboundMoveAt: number | null = null;
  private flushed = false;

  constructor(private readonly outDir: string, private readonly durationMs: number, private readonly getSelfId: () => string) {}

  record(packet: unknown): void {
    if (this.flushed || !packet || typeof packet !== 'object' || Array.isArray(packet)) return;
    const p = packet as Record<string, unknown>;
    const op = typeof p.op === 'string' ? p.op : 'unknown';
    const at = Date.now() - this.startedAt;
    this.ops.set(op, (this.ops.get(op) ?? 0) + 1);
    const keys = this.opKeys.get(op) ?? new Set<string>();
    Object.keys(p).filter((key) => !REDACTED_STRUCTURAL_KEYS.has(key)).forEach((key) => keys.add(key));
    this.opKeys.set(op, keys);
    if (this.firstPackets.length < 30) this.firstPackets.push({ at, op });

    const numeric = Object.fromEntries(
      NUMERIC_KEYS
        .filter((key) => Object.prototype.hasOwnProperty.call(p, key))
        .map((key) => [key, redactedNumber(p[key])]),
    ) as Record<string, RedactedNumber>;
    if (Object.keys(numeric).length > 0 && this.numericFields.length < 200) {
      this.numericFields.push({ at, op, fields: numeric });
    }

    if (op === 'state' && this.statePackets.length < 10) {
      const save = isRecord(p.save) ? p.save : {};
      const equipmentValue = p.equipment ?? save.equipment;
      const equipment = isRecord(equipmentValue) ? equipmentValue : {};
      this.statePackets.push({
        at,
        keys: Object.keys(p).filter((key) => !REDACTED_STRUCTURAL_KEYS.has(key)).sort(),
        saveKeys: Object.keys(save).filter((key) => !REDACTED_STRUCTURAL_KEYS.has(key)).sort(),
        equipment: Object.entries(equipment)
          .map(([slot, item]) => ({ slot, id: redactedItemId(item) }))
          .sort((a, b) => a.slot.localeCompare(b.slot)),
        realm: redactedRealm(p.realm),
        saveRealm: redactedRealm(save.realm),
      });
    }

    if (op === 'you' && this.youPackets.length < 100) {
      const fields: Record<string, RedactedNumber> = { at };
      for (const key of YOU_KEYS) fields[key] = redactedNumber(p[key]);
      fields.delayMs = this.lastOutboundMoveAt === null ? null : Math.max(0, at - this.lastOutboundMoveAt);
      this.youPackets.push(fields);
    }

    const selfId = this.getSelfId();
    for (const [key, value] of Object.entries(p)) {
      if (!Array.isArray(value) || value.length === 0) continue;
      const first = value[0];
      if (!first || typeof first !== 'object' || Array.isArray(first) || !('id' in first) || !('x' in first)) continue;
      const slot = `${op}.${key}`;
      const shape = this.arrays.get(slot) ?? { packets: 0, rows: 0, keys: new Set<string>(), idTypes: new Set<string>() };
      shape.packets += 1;
      shape.rows += value.length;
      for (const row of value.slice(0, 5)) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const record = row as Record<string, unknown>;
        Object.keys(record).filter((field) => !REDACTED_STRUCTURAL_KEYS.has(field)).forEach((field) => shape.keys.add(field));
        shape.idTypes.add(typeof record.id);
      }
      const selfRow = selfId ? value.find((row) => !!row && typeof row === 'object' && !Array.isArray(row)
        && (row as Record<string, unknown>).id === selfId) as Record<string, unknown> | undefined : undefined;
      if (selfRow && this.selfEntries.length < 20) {
        const numericVitals: Record<string, number | null> = {};
        for (const field of ['hp', 'maxHp', 'mp', 'maxMp']) {
          const n = selfRow[field];
          if (typeof n === 'number' && Number.isFinite(n)) numericVitals[field] = n;
        }
      this.selfEntries.push({
        at,
        slot,
        keys: Object.keys(selfRow).filter((key) => !REDACTED_STRUCTURAL_KEYS.has(key)).sort(),
        numericVitals,
      });
      }
      this.arrays.set(slot, shape);
    }
    const save = p.save && typeof p.save === 'object' && !Array.isArray(p.save) ? p.save as Record<string, unknown> : {};
    if (['hp', 'maxHp', 'mp', 'maxMp'].some((k) => k in p || k in save) && this.vitalPackets.length < 50) {
      const pick = (source: Record<string, unknown>) => Object.fromEntries(
        ['hp', 'maxHp', 'mp', 'maxMp'].filter((k) => typeof source[k] === 'number' && Number.isFinite(source[k])).map((k) => [k, source[k]]),
      );
      this.vitalPackets.push({ at, op, top: pick(p), save: pick(save) });
    }
    if (Date.now() - this.startedAt >= this.durationMs) this.flush();
  }

  /** Store only the movement fields needed to correlate an outbound move with `you`. */
  recordOutboundMove(move: { seq: unknown; x: unknown; y: unknown; st?: unknown; ep?: unknown }): void {
    if (this.flushed || this.outboundMoves.length >= 500) return;
    const at = Date.now() - this.startedAt;
    const rounded = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
    this.outboundMoves.push({
      at,
      seq: rounded(move.seq),
      x: rounded(move.x),
      y: rounded(move.y),
      st: typeof move.st === 'string' ? move.st : null,
      ep: redactedNumber(move.ep),
    });
    this.lastOutboundMoveAt = at;
    if (Date.now() - this.startedAt >= this.durationMs) this.flush();
  }

  /** Begin a redacted stationary-probe batch; outbound moves are correlated by tap-local order. */
  beginStationaryProbeBatch(input: {
    label: string;
    st: unknown;
    x: unknown;
    y: unknown;
    positionBefore: { x: unknown; y: unknown };
  }): void {
    if (this.flushed || this.activeStationaryProbeBatch) return;
    const rounded = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
    this.activeStationaryProbeBatch = {
      label: input.label,
      atStart: Date.now() - this.startedAt,
      outboundStartIndex: this.outboundMoves.length,
      st: typeof input.st === 'string' ? input.st : null,
      x: rounded(input.x),
      y: rounded(input.y),
      positionBefore: { x: rounded(input.positionBefore.x), y: rounded(input.positionBefore.y) },
    };
  }

  /** Finish a redacted stationary-probe batch and record its sequence span and runtime position. */
  endStationaryProbeBatch(input: {
    label: string;
    youCount: number;
    positionAfter: { x: unknown; y: unknown } | null;
  }): void {
    if (this.flushed || !this.activeStationaryProbeBatch) return;
    const active = this.activeStationaryProbeBatch;
    this.activeStationaryProbeBatch = null;
    const moves = this.outboundMoves.slice(active.outboundStartIndex);
    const rounded = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
    this.stationaryProbeBatches.push({
      label: input.label,
      atStart: active.atStart,
      atEnd: Date.now() - this.startedAt,
      seqStart: moves[0]?.seq ?? null,
      seqEnd: moves[moves.length - 1]?.seq ?? null,
      st: active.st,
      x: active.x,
      y: active.y,
      movesSent: moves.length,
      youCount: Math.max(0, Math.floor(input.youCount)),
      positionBefore: active.positionBefore,
      positionAfter: input.positionAfter
        ? { x: rounded(input.positionAfter.x), y: rounded(input.positionAfter.y) }
        : { x: null, y: null },
    });
  }

  /** Attach a redacted you packet to the currently running stationary-probe batch. */
  recordStationaryProbeYou(label: string, packet: Record<string, unknown>): void {
    if (this.flushed || this.stationaryProbeYou.length >= 100) return;
    const at = Date.now() - this.startedAt;
    const value = (key: string): RedactedNumber => redactedNumber(packet[key]);
    this.stationaryProbeYou.push({
      batch: label,
      at,
      seq: value('seq'),
      hp: value('hp'),
      mp: value('mp'),
      sp: value('sp'),
      bp: value('bp'),
      dn: value('dn'),
      fix: value('fix'),
      delayMs: this.lastOutboundMoveAt === null ? null : Math.max(0, at - this.lastOutboundMoveAt),
    });
  }

  recordStationaryProbeCancellation(reason: string): void {
    if (this.flushed || this.stationaryProbeCancellations.length >= 10) return;
    this.stationaryProbeCancellations.push({
      at: Date.now() - this.startedAt,
      reason: reason.slice(0, 120),
    });
  }

  flush(): void {
    if (this.flushed) return;
    this.flushed = true;
    fs.mkdirSync(this.outDir, { recursive: true });
    const file = path.join(this.outDir, `packet-tap-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const entityArrays = Object.fromEntries([...this.arrays].map(([key, shape]) => [key, {
      packets: shape.packets, rows: shape.rows, keys: [...shape.keys].sort(), idTypes: [...shape.idTypes],
    }]));
    const opKeys = Object.fromEntries([...this.opKeys].map(([op, keys]) => [op, [...keys].sort()]));
    fs.writeFileSync(file, JSON.stringify({
      durationMs: Date.now() - this.startedAt,
      ops: Object.fromEntries(this.ops),
      opKeys,
      firstPackets: this.firstPackets,
      statePackets: this.statePackets,
      youPackets: this.youPackets,
      outboundMoves: this.outboundMoves,
      stationaryProbe: {
        batches: this.stationaryProbeBatches,
        you: this.stationaryProbeYou,
        cancellations: this.stationaryProbeCancellations,
      },
      numericFields: this.numericFields,
      entityArrays,
      vitalPackets: this.vitalPackets,
      selfEntries: this.selfEntries,
    }, null, 2));
  }
}
