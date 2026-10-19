/**
 * Splits the city into one region per area (권역) by nearest area center, a Voronoi split.
 * This is an approximation: the citydata response has no boundary polygons, only centers.
 * Client-safe: plain geometry only.
 */

export interface AreaCenter {
  name: string;
  x: number;
  z: number;
}

export interface AreaRegion {
  name: string;
  color: string;
  /** Convex polygon in the city's meter frame, as [x, z] pairs */
  points: [number, number][];
}

type Point = [number, number];
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

const AREA_COLORS = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#b07aa1', '#edc948', '#9c755f', '#bab0ac'];

/** Color for the area at this index. Used by both the map and the legend. */
export function areaColor(index: number): string {
  return AREA_COLORS[index % AREA_COLORS.length];
}

/** Keeps the part of a convex polygon where f(p) <= 0 (Sutherland–Hodgman, one edge). */
function clipHalfPlane(polygon: Point[], f: (p: Point) => number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if (fa * fb < 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * Each center's region is the part of the rectangle closer to it than to any other center.
 * Closer to c than to o means (p - midpoint) · (o - c) <= 0, which is a half-plane.
 */
export function areaRegions(centers: AreaCenter[], rect: Rect): AreaRegion[] {
  return centers.map((center, i) => {
    let points: Point[] = [
      [rect.minX, rect.minZ],
      [rect.maxX, rect.minZ],
      [rect.maxX, rect.maxZ],
      [rect.minX, rect.maxZ],
    ];
    centers.forEach((other, j) => {
      if (j === i) return;
      const dx = other.x - center.x;
      const dz = other.z - center.z;
      const mx = (center.x + other.x) / 2;
      const mz = (center.z + other.z) / 2;
      points = clipHalfPlane(points, ([x, z]) => (x - mx) * dx + (z - mz) * dz);
    });
    return { name: center.name, color: areaColor(i), points };
  });
}
