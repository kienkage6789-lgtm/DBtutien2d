import fs from 'node:fs';
import os from 'node:os';

/** Parse Linux /proc/meminfo without exposing the file path or its contents. */
export function parseMemAvailableBytes(content: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(content);
  if (!match) return null;
  const kibibytes = Number(match[1]);
  return Number.isSafeInteger(kibibytes) ? kibibytes * 1024 : null;
}

export function readAvailableMemoryBytes(
  readFile: (filePath: string, encoding: BufferEncoding) => string = (filePath, encoding) => fs.readFileSync(filePath, encoding),
  freeMemory: () => number = () => os.freemem(),
  platform: string = process.platform,
): number {
  if (platform === 'linux') {
    try {
      const available = parseMemAvailableBytes(readFile('/proc/meminfo', 'utf8'));
      if (available !== null) return available;
    } catch {
      // Fall back to the platform API when /proc is unavailable or unreadable.
    }
  }
  return Math.max(0, freeMemory());
}

export function availableMemoryMb(bytes: number): number {
  return Math.floor(Math.max(0, bytes) / (1024 * 1024));
}

export function hasEnoughMemory(availableBytes: number, minimumMb: number): boolean {
  return minimumMb <= 0 || availableBytes >= minimumMb * 1024 * 1024;
}
