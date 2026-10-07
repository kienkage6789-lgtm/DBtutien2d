export type OperationKind = 'move' | 'attack' | 'skill';
export type OperationStatus = 'sent' | 'confirmed' | 'unconfirmed' | 'failed';

export interface OperationEntry {
  key: string;
  kind: OperationKind;
  seq: number;
  sentAt: number;
  confirmBy: number;
  status: OperationStatus;
}

/** Tracks local socket writes and observed completion; never retries a packet. */
export class OperationLedger {
  private readonly entries = new Map<string, OperationEntry>();
  private sequence = 0;

  begin(kind: OperationKind, key: string, now = Date.now()): OperationEntry | null {
    this.sweep(now);
    const previous = this.entries.get(key);
    const interval = kind === 'attack' ? 600 : kind === 'skill' ? 800 : 0;
    if (previous?.status === 'sent' || previous && now - previous.sentAt < interval) return null;
    const window = kind === 'attack' ? 1200 : 1500;
    const entry = { key, kind, seq: ++this.sequence, sentAt: now, confirmBy: now + window, status: 'sent' as const };
    this.entries.set(key, entry);
    while (this.entries.size > 200) this.entries.delete(this.entries.keys().next().value!);
    return entry;
  }

  confirm(key: string): void { const entry = this.entries.get(key); if (entry) entry.status = 'confirmed'; }
  fail(key: string): void { const entry = this.entries.get(key); if (entry) entry.status = 'failed'; }
  sweep(now = Date.now()): OperationEntry[] {
    const expired: OperationEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === 'sent' && now >= entry.confirmBy) { entry.status = 'unconfirmed'; expired.push(entry); }
    }
    return expired;
  }
  get(key: string): OperationEntry | undefined { return this.entries.get(key); }
  reset(): void { this.entries.clear(); this.sequence = 0; }
}
