export interface Snap2Entity {
  id: string;
  [key: string]: unknown;
}

export interface Snap2Packet {
  op?: 'snap2';
  /** Wire servers use either boolean true or compact numeric 1. */
  full?: boolean | number | string;
  sq?: number;
  t?: number;
  ep?: number;
  /** Patch existing players; full/upsert players are carried in pf. */
  p?: Array<Partial<Snap2Entity> & { id: string }>;
  /** Patch existing monsters; full/upsert monsters are carried in ef. */
  e?: Array<Partial<Snap2Entity> & { id: string }>;
  gp?: string[];
  ge?: string[];
  pf?: Snap2Entity[];
  ef?: Snap2Entity[];
}

export interface Snap2Context {
  mapId: string;
  khu: number;
  contextEpoch: number;
  mapEpoch?: number;
}

export interface ReducedWorldSnapshot extends Snap2Context {
  sequence: number;
  observedAt: number;
  players: Snap2Entity[];
  monsters: Snap2Entity[];
}

export type Snap2Result =
  | { ok: true; snapshot: ReducedWorldSnapshot }
  | { ok: false; reason: 'invalid' | 'stale' | 'context' | 'gap' | 'needs_full' };

/** Deterministic reducer for the public client's snap2 full/delta wire format. */
export class Snap2Reducer {
  private sequence: number | null = null;
  private contextKey: string | null = null;
  private players = new Map<string, Snap2Entity>();
  private monsters = new Map<string, Snap2Entity>();
  private needsFull = true;

  public reset(): void {
    this.sequence = null;
    this.contextKey = null;
    this.players.clear();
    this.monsters.clear();
    this.needsFull = true;
  }

  public apply(packet: Snap2Packet, context: Snap2Context, observedAt = Date.now()): Snap2Result {
    const full = packet.full === true || packet.full === 1 || packet.full === '1';
    if (!Number.isSafeInteger(packet.sq)
      || (full ? (packet.sq as number) < -1 : (packet.sq as number) < 0)
      || !Number.isFinite(observedAt) || !context.mapId || !Number.isFinite(context.khu)
      || !Number.isSafeInteger(context.contextEpoch)
      || (packet.ep !== undefined && !Number.isSafeInteger(packet.ep))) return { ok: false, reason: 'invalid' };
    if (context.mapEpoch !== undefined && packet.ep !== undefined && packet.ep !== context.mapEpoch) {
      return { ok: false, reason: 'context' };
    }

    const key = `${context.mapId}\u0000${context.khu}\u0000${context.contextEpoch}\u0000${context.mapEpoch ?? ''}`;
    if (this.contextKey !== key) {
      this.contextKey = key;
      this.sequence = null;
      this.players.clear();
      this.monsters.clear();
      this.needsFull = true;
    }
    // A full snapshot is a recovery boundary. The server may replay it with the
    // same or an older sequence after resync; only deltas must be monotonic.
    if (!full && this.sequence !== null && (packet.sq as number) <= this.sequence) {
      return { ok: false, reason: 'stale' };
    }
    if (!full && this.needsFull) return { ok: false, reason: 'needs_full' };
    if (!full && packet.sq !== this.sequence! + 1) {
      this.needsFull = true;
      return { ok: false, reason: 'gap' };
    }

    const players = full ? new Map<string, Snap2Entity>() : new Map(this.players);
    const monsters = full ? new Map<string, Snap2Entity>() : new Map(this.monsters);
    if (![packet.p, packet.e, packet.gp, packet.ge, packet.pf, packet.ef].every((v) => v === undefined || Array.isArray(v))) {
      return { ok: false, reason: 'invalid' };
    }
    const remove = (target: Map<string, Snap2Entity>, ids: string[] = []) => ids.every((id) => {
      if (typeof id !== 'string' || !id) return false;
      target.delete(id);
      return true;
    });
    const upsert = (target: Map<string, Snap2Entity>, rows: Snap2Entity[] = []) => rows.every((row) => {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) return false;
      target.set(row.id, { ...row });
      return true;
    });
    const patch = (target: Map<string, Snap2Entity>, rows: Array<Partial<Snap2Entity> & { id: string }> = []) => rows.every((row) => {
      const current = target.get(row?.id);
      if (!current) return false;
      const next: Record<string, unknown> = { ...current };
      for (const [field, value] of Object.entries(row)) {
        if (field === 'id') continue;
        if (value === null) delete next[field];
        else next[field] = value;
      }
      target.set(row.id, next as Snap2Entity);
      return true;
    });
    // Public wire contract: pf/ef upsert entities, p/e patch existing ones.
    if (!remove(players, packet.gp) || !remove(monsters, packet.ge)
      || !upsert(players, packet.pf) || !upsert(monsters, packet.ef)
      || !patch(players, packet.p) || !patch(monsters, packet.e)) {
      this.needsFull = true;
      return { ok: false, reason: 'invalid' };
    }
    this.players = players;
    this.monsters = monsters;
    this.sequence = packet.sq as number;
    this.needsFull = false;
    return {
      ok: true,
      snapshot: {
        ...context,
        sequence: this.sequence,
        observedAt,
        players: [...players.values()].map((entity) => ({ ...entity })),
        monsters: [...monsters.values()].map((entity) => ({ ...entity })),
      },
    };
  }
}
