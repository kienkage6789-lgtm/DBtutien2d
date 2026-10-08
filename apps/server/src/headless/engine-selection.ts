export type RuntimeEngine = 'vendor';

export function assertSingleEngine(activeEngine: RuntimeEngine | null, requestedEngine: RuntimeEngine): void {
  if (requestedEngine !== 'vendor' || (activeEngine !== null && activeEngine !== 'vendor')) {
    throw new Error('ENGINE_VENDOR_ONLY');
  }
}
