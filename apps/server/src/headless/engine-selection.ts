export type RuntimeEngine = 'core' | 'vendor';

export function assertSingleEngine(activeEngine: RuntimeEngine | null, requestedEngine: RuntimeEngine): void {
  if (activeEngine && activeEngine !== requestedEngine) {
    throw new Error('ENGINE_ALREADY_RUNNING: account already has another engine session');
  }
}
