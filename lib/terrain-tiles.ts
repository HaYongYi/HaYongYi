import { lonLatToMeters, metersToLonLat } from './geo';

/** Zoom of the base map tiles. About 1 km per tile across central Seoul. */
export const TERRAIN_ZOOM = 15;

export interface TerrainTile {
  z: number;
  x: number;
  y: number;
  /** Tile edges in the city meter frame. North is the smaller z. */
  west: number;
  east: number;
  north: number;
  south: number;
}

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

// Standard web map tile math (Web Mercator tiling)
function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Every tile at zoom `z` that covers the rectangle, with its edges in the city meter frame. */
export function tilesCovering(rect: Rect, z = TERRAIN_ZOOM): TerrainTile[] {
  const [west, north] = metersToLonLat(rect.minX, rect.minZ);
  const [east, south] = metersToLonLat(rect.maxX, rect.maxZ);
  const tiles: TerrainTile[] = [];
  for (let x = lonToTileX(west, z); x <= lonToTileX(east, z); x++) {
    for (let y = latToTileY(north, z); y <= latToTileY(south, z); y++) {
      const [w, n] = lonLatToMeters(tileToLon(x, z), tileToLat(y, z));
      const [e, s] = lonLatToMeters(tileToLon(x + 1, z), tileToLat(y + 1, z));
      tiles.push({ z, x, y, west: w, east: e, north: n, south: s });
    }
  }
  return tiles;
}
