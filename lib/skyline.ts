import { elevationAt, type ElevationGrid } from './elevation';
import type { Building } from './types';

/**
 * Skyline analysis from one viewpoint, after Karimimoshaver & Derakhshan (2026):
 * the physical skyline (building heights against the terrain ridge) is reduced to
 * measurable visual variables — skyline intrusion, natural-view obstruction, silhouette
 * complexity, visual dominance, clustering and sky openness. No perception survey is
 * involved; the numbers describe the physical–visual layer only.
 */

export const AZIMUTH_BINS = 360;
/** Eye height above ground (m), a standing pedestrian. */
export const EYE_HEIGHT = 1.6;
/** Buildings farther than this (m) are left out of the silhouette. */
export const BUILDING_RANGE = 4000;
/** Terrain profile is sampled out to this distance (m). */
export const TERRAIN_RANGE = 12000;
const TERRAIN_STEP = 45;
/** A terrain line steeper than this (deg) counts as a visible natural ridge. */
const RIDGE_MIN_ANGLE = 1;
/** Intrusion runs no wider than this (deg) count as solitary, wider ones as clustered. */
const SOLITARY_MAX_WIDTH = 3;
/** Minimum prominence (deg) for a bump in the silhouette to count as a peak. */
const PEAK_PROMINENCE = 0.5;

export interface SkylineBin {
  /** Elevation angle of the terrain line, degrees above the horizon */
  terrain: number;
  /** Elevation angle of the highest building, degrees above the horizon (−90 when none) */
  building: number;
  /** Building that forms the silhouette in this bin */
  buildingId: string | null;
}

export interface SkylineMetrics {
  /** Share of all directions where a building forms the skyline (above terrain) */
  buildingSkylineShare: number;
  /** Among directions with a natural ridge, share where buildings rise above it */
  naturalViewObstruction: number;
  /** Number of peaks in the combined silhouette */
  peaks: number;
  /** Mean absolute change of the silhouette angle between neighbouring bins (deg) */
  roughness: number;
  /** Mean of (90° − skyline angle) / 90° over all directions */
  skyOpenness: number;
  /** Highest building angle and the building responsible */
  dominantAngle: number;
  dominantBuildingId: string | null;
  /** Runs of consecutive intrusion bins */
  intrusionRuns: number;
  solitaryRuns: number;
  clusteredRuns: number;
  /** Buildings that form the silhouette anywhere, and those that cross the terrain line */
  visibleCount: number;
  intrudingCount: number;
}

export interface SkylineResult {
  viewpoint: [number, number];
  eyeY: number;
  bins: SkylineBin[];
  metrics: SkylineMetrics;
  visibleIds: Set<string>;
  intrudingIds: Set<string>;
}

const DEG = 180 / Math.PI;

/** Azimuth in degrees clockwise from north. The city frame has x east and z south. */
function azimuthOf(dx: number, dz: number): number {
  const a = Math.atan2(dx, -dz) * DEG;
  return a < 0 ? a + 360 : a;
}

function binOf(azimuth: number): number {
  return ((Math.floor((azimuth / 360) * AZIMUTH_BINS) % AZIMUTH_BINS) + AZIMUTH_BINS) % AZIMUTH_BINS;
}

function insideGrid(grid: ElevationGrid, x: number, z: number): boolean {
  const col = (x - grid.originX) / grid.stepX;
  const row = (z - grid.originZ) / grid.stepZ;
  return col >= 0 && row >= 0 && col <= grid.ncols - 1 && row <= grid.nrows - 1;
}

/** Terrain elevation angle per azimuth: the steepest ground sample along each ray. */
function terrainProfile(grid: ElevationGrid | null, vx: number, vz: number, eyeY: number): number[] {
  const profile = new Array<number>(AZIMUTH_BINS).fill(0);
  if (!grid) return profile;
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    const az = ((i + 0.5) / AZIMUTH_BINS) * 2 * Math.PI;
    const sx = Math.sin(az);
    const sz = -Math.cos(az);
    let best = -90;
    for (let s = TERRAIN_STEP; s <= TERRAIN_RANGE; s += TERRAIN_STEP) {
      const x = vx + sx * s;
      const z = vz + sz * s;
      if (!insideGrid(grid, x, z)) break;
      const angle = Math.atan2(elevationAt(grid, x, z) - eyeY, s) * DEG;
      if (angle > best) best = angle;
    }
    profile[i] = Math.max(best, 0);
  }
  return profile;
}

/**
 * Fills the building silhouette: for each building in range, the azimuth span of its
 * footprint box and the elevation angle of its top at the nearest point of the box.
 */
function buildingProfile(
  buildings: Building[],
  grid: ElevationGrid | null,
  vx: number,
  vz: number,
  eyeY: number,
): { angles: number[]; ids: (string | null)[] } {
  const angles = new Array<number>(AZIMUTH_BINS).fill(-90);
  const ids = new Array<string | null>(AZIMUTH_BINS).fill(null);

  for (const b of buildings) {
    if (b.underground) continue;
    const dx = b.x - vx;
    const dz = b.z - vz;
    const centerDistance = Math.hypot(dx, dz);
    if (centerDistance > BUILDING_RANGE) continue;

    const halfW = b.width / 2;
    const halfD = b.depth / 2;
    // Nearest point of the footprint box to the viewpoint
    const nx = Math.min(Math.max(vx, b.x - halfW), b.x + halfW);
    const nz = Math.min(Math.max(vz, b.z - halfD), b.z + halfD);
    const nearest = Math.hypot(nx - vx, nz - vz);
    if (nearest < 1) continue; // standing inside or on the building

    const top = elevationAt(grid, b.x, b.z) + b.height;
    const angle = Math.atan2(top - eyeY, nearest) * DEG;
    if (angle <= 0) continue;

    // Azimuth span of the four corners, handling wrap-around at north
    const corners = [
      azimuthOf(b.x - halfW - vx, b.z - halfD - vz),
      azimuthOf(b.x + halfW - vx, b.z - halfD - vz),
      azimuthOf(b.x - halfW - vx, b.z + halfD - vz),
      azimuthOf(b.x + halfW - vx, b.z + halfD - vz),
    ];
    const center = azimuthOf(dx, dz);
    let minOffset = 0;
    let maxOffset = 0;
    for (const c of corners) {
      let offset = c - center;
      if (offset > 180) offset -= 360;
      if (offset < -180) offset += 360;
      if (offset < minOffset) minOffset = offset;
      if (offset > maxOffset) maxOffset = offset;
    }
    const first = binOf(center + minOffset);
    const count = Math.max(1, Math.round(((maxOffset - minOffset) / 360) * AZIMUTH_BINS));
    for (let k = 0; k <= count; k++) {
      const i = (first + k) % AZIMUTH_BINS;
      if (angle > angles[i]) {
        angles[i] = angle;
        ids[i] = b.id;
      }
    }
  }
  return { angles, ids };
}

function countPeaks(values: number[]): number {
  let peaks = 0;
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const prev = values[(i - 1 + n) % n];
    const next = values[(i + 1) % n];
    if (values[i] > prev && values[i] >= next && values[i] - Math.min(prev, next) >= PEAK_PROMINENCE) peaks++;
  }
  return peaks;
}

export function analyzeSkyline(
  viewpoint: [number, number],
  buildings: Building[],
  grid: ElevationGrid | null,
): SkylineResult {
  const [vx, vz] = viewpoint;
  const eyeY = elevationAt(grid, vx, vz) + EYE_HEIGHT;

  const terrain = terrainProfile(grid, vx, vz, eyeY);
  const { angles, ids } = buildingProfile(buildings, grid, vx, vz, eyeY);

  const bins: SkylineBin[] = terrain.map((t, i) => ({ terrain: t, building: angles[i], buildingId: ids[i] }));

  const visibleIds = new Set<string>();
  const intrudingIds = new Set<string>();
  const intrusion = new Array<boolean>(AZIMUTH_BINS).fill(false);
  const skyline = new Array<number>(AZIMUTH_BINS);
  let ridgeBins = 0;
  let obstructedRidgeBins = 0;
  let buildingBins = 0;
  let dominantAngle = 0;
  let dominantBuildingId: string | null = null;
  let opennessSum = 0;

  for (let i = 0; i < AZIMUTH_BINS; i++) {
    const { terrain: t, building: b, buildingId } = bins[i];
    const above = b > t && buildingId !== null;
    skyline[i] = Math.max(t, b, 0);
    opennessSum += (90 - skyline[i]) / 90;
    if (buildingId !== null && b > 0) visibleIds.add(buildingId);
    if (above) {
      buildingBins++;
      intrusion[i] = true;
      intrudingIds.add(buildingId as string);
    }
    if (t >= RIDGE_MIN_ANGLE) {
      ridgeBins++;
      if (above) obstructedRidgeBins++;
    }
    if (b > dominantAngle) {
      dominantAngle = b;
      dominantBuildingId = buildingId;
    }
  }

  // Runs of consecutive intrusion bins (circular)
  let runs = 0;
  let solitaryRuns = 0;
  let clusteredRuns = 0;
  const allIntrude = intrusion.every(Boolean);
  if (allIntrude) {
    runs = clusteredRuns = 1;
  } else {
    // Start counting from a bin without intrusion so no run is split by the wrap
    const start = intrusion.indexOf(false);
    let width = 0;
    for (let k = 1; k <= AZIMUTH_BINS; k++) {
      const i = (start + k) % AZIMUTH_BINS;
      if (intrusion[i]) {
        width++;
      } else if (width > 0) {
        runs++;
        if ((width / AZIMUTH_BINS) * 360 <= SOLITARY_MAX_WIDTH) solitaryRuns++;
        else clusteredRuns++;
        width = 0;
      }
    }
  }

  let roughnessSum = 0;
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    roughnessSum += Math.abs(skyline[i] - skyline[(i + 1) % AZIMUTH_BINS]);
  }

  const metrics: SkylineMetrics = {
    buildingSkylineShare: buildingBins / AZIMUTH_BINS,
    naturalViewObstruction: ridgeBins > 0 ? obstructedRidgeBins / ridgeBins : 0,
    peaks: countPeaks(skyline),
    roughness: roughnessSum / AZIMUTH_BINS,
    skyOpenness: opennessSum / AZIMUTH_BINS,
    dominantAngle,
    dominantBuildingId,
    intrusionRuns: runs,
    solitaryRuns,
    clusteredRuns,
    visibleCount: visibleIds.size,
    intrudingCount: intrudingIds.size,
  };

  return { viewpoint, eyeY, bins, metrics, visibleIds, intrudingIds };
}
