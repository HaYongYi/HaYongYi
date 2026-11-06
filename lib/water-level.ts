import type { ElevationGrid } from './elevation';

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * DEM cell indices (row * ncols + col) whose center lies in `rect` and whose ground is below
 * the water level. Everything under this level would be submerged.
 */
export function submergedCells(grid: ElevationGrid, level: number, rect: Rect): number[] {
  const cells: number[] = [];
  for (let row = 0; row < grid.nrows; row++) {
    const z = grid.originZ + row * grid.stepZ;
    if (z < rect.minZ || z > rect.maxZ) continue;
    for (let col = 0; col < grid.ncols; col++) {
      const x = grid.originX + col * grid.stepX;
      if (x < rect.minX || x > rect.maxX) continue;
      const index = row * grid.ncols + col;
      if (grid.heights[index] < level) cells.push(index);
    }
  }
  return cells;
}
