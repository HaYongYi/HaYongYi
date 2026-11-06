import type { Building } from './types';
import type { ElevationGrid } from './elevation';

/**
 * 1급 후보: low-lying and dense at the same time. 저지대: only low-lying. 밀집: only dense.
 * This is a screening aid, not a flood analysis. Drainage, rivers and sewer capacity are not included.
 */
export type FloodClass = 'primary' | 'low' | 'dense';

export interface FloodCell {
  row: number;
  col: number;
  cls: FloodClass;
}

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Lowest share of city cells counted as low-lying. */
const LOW_SHARE = 0.3;
/** Highest share of city cells counted as dense. */
const DENSE_SHARE = 0.3;
const FLOOR_HEIGHT = 3.3;

function valueAtShare(sortedAscending: number[], share: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.floor(share * (sortedAscending.length - 1)));
  return sortedAscending[index];
}

/**
 * Screens DEM cells whose centers lie inside `rect`. Density is building floor area per cell,
 * because population and building age are not in the data yet.
 */
export function floodScreening(grid: ElevationGrid, buildings: Building[], rect: Rect): FloodCell[] {
  const floorArea = new Float64Array(grid.nrows * grid.ncols);
  for (const b of buildings) {
    if (b.underground) continue;
    const col = Math.floor((b.x - grid.originX) / grid.stepX);
    const row = Math.floor((b.z - grid.originZ) / grid.stepZ);
    if (col < 0 || row < 0 || col >= grid.ncols || row >= grid.nrows) continue;
    const floors = Math.max(1, Math.round(b.height / FLOOR_HEIGHT));
    floorArea[row * grid.ncols + col] += b.width * b.depth * floors;
  }

  const cells: number[] = [];
  for (let row = 0; row < grid.nrows; row++) {
    for (let col = 0; col < grid.ncols; col++) {
      const x = grid.originX + col * grid.stepX;
      const z = grid.originZ + row * grid.stepZ;
      if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) cells.push(row * grid.ncols + col);
    }
  }

  const elevations = cells.map((i) => grid.heights[i]).sort((a, b) => a - b);
  const densities = cells.map((i) => floorArea[i]).filter((area) => area > 0).sort((a, b) => a - b);
  const lowCut = valueAtShare(elevations, LOW_SHARE);
  const denseCut = valueAtShare(densities, 1 - DENSE_SHARE);

  const result: FloodCell[] = [];
  for (const i of cells) {
    const low = grid.heights[i] <= lowCut;
    const dense = floorArea[i] > 0 && floorArea[i] >= denseCut;
    if (!low && !dense) continue;
    const cls: FloodClass = low && dense ? 'primary' : low ? 'low' : 'dense';
    result.push({ row: Math.floor(i / grid.ncols), col: i % grid.ncols, cls });
  }
  return result;
}
