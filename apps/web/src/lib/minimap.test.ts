import { describe, expect, it } from 'vitest';
import { isValidWorldBounds, miniMapToWorld, worldToMiniMap } from './minimap';

describe('mini-map coordinate transforms', () => {
  const bounds = { minX: 10, minY: 20, maxX: 810, maxY: 620 };

  it('round-trips world points without flipping the Y axis', () => {
    const world = { x: 410, y: 320 };
    const mini = worldToMiniMap(world, bounds, 1000, 600);
    expect(mini).toEqual({ x: 500, y: 300 });
    expect(miniMapToWorld(mini, bounds, 1000, 600)).toEqual(world);
  });

  it('rejects non-positive or non-finite geometry', () => {
    expect(isValidWorldBounds(bounds)).toBe(true);
    expect(isValidWorldBounds({ ...bounds, maxX: bounds.minX })).toBe(false);
    expect(isValidWorldBounds({ ...bounds, maxY: Number.NaN })).toBe(false);
  });
});
