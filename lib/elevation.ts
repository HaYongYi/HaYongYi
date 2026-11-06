/**
 * Height grid from the DEM, produced by scripts/import-dem.mjs. Rows run south from
 * originZ, columns run east from originX. Client-safe: plain math only.
 */
export interface ElevationGrid {
  ncols: number;
  nrows: number;
  originX: number;
  originZ: number;
  stepX: number;
  stepZ: number;
  heights: number[];
}

/** Ground height at a city-frame point, interpolated between grid cells. 0 outside the grid. */
export function elevationAt(grid: ElevationGrid | null | undefined, x: number, z: number): number {
  if (!grid) return 0;
  const col = (x - grid.originX) / grid.stepX;
  const row = (z - grid.originZ) / grid.stepZ;
  if (col < 0 || row < 0 || col > grid.ncols - 1 || row > grid.nrows - 1) return 0;

  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(c0 + 1, grid.ncols - 1);
  const r1 = Math.min(r0 + 1, grid.nrows - 1);
  const fc = col - c0;
  const fr = row - r0;
  const at = (r: number, c: number) => grid.heights[r * grid.ncols + c];

  const top = at(r0, c0) * (1 - fc) + at(r0, c1) * fc;
  const bottom = at(r1, c0) * (1 - fc) + at(r1, c1) * fc;
  return top * (1 - fr) + bottom * fr;
}
