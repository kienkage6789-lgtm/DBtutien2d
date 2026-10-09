import { CONFIG } from '../config.js';
import { hasEnoughMemory, readAvailableMemoryBytes } from '../system/memory.js';

export function hasRunnerMemoryCapacity(
  minimumMb: number = CONFIG.MIN_FREE_MEM_MB,
  readMemory: () => number = readAvailableMemoryBytes,
): boolean {
  return hasEnoughMemory(readMemory(), minimumMb);
}
