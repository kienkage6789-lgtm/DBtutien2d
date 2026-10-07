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

/** Invert an SVG click while accounting for preserveAspectRatio="xMidYMid meet" letterboxing. */
export const miniMapToWorld = (
  client: Point,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  bounds: WorldBounds,
  width = 1000,
  height = 600,
): Point | null => {
  if (!rect.width || !rect.height || !isValidWorldBounds(bounds)) return null;
  const scale = Math.min(rect.width / width, rect.height / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const px = (client.x - rect.left - offsetX) / renderedWidth;
  const py = (client.y - rect.top - offsetY) / renderedHeight;
  if (px < 0 || px > 1 || py < 0 || py > 1) return null;
  return {
    x: bounds.minX + px * (bounds.maxX - bounds.minX),
    y: bounds.minY + py * (bounds.maxY - bounds.minY),
  };
};
