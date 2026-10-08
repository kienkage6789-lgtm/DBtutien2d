export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  tileSize?: number;
  portals?: Array<{
    portalId: string;
    fromMapId: string;
    toMapId: string;
    tx: number;
    ty: number;
    label?: string;
  }>;
}

export interface Point { x: number; y: number }

export const isValidWorldBounds = (bounds?: WorldBounds | null): bounds is WorldBounds =>
  !!bounds && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
  && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;

/** Convert game world coordinates to normalized SVG coordinates. The client map uses Y-down pixels. */
export const worldToMiniMap = (point: Point, bounds: WorldBounds, width = 1000, height = 600): Point => ({
  x: ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
  y: ((point.y - bounds.minY) / (bounds.maxY - bounds.minY)) * height,
});

/** Convert normalized SVG coordinates back to the client's Y-down world pixels. */
export const miniMapToWorld = (point: Point, bounds: WorldBounds, width = 1000, height = 600): Point => ({
  x: bounds.minX + (point.x / width) * (bounds.maxX - bounds.minX),
  y: bounds.minY + (point.y / height) * (bounds.maxY - bounds.minY),
});
