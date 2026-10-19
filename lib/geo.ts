/**
 * Local meter frame centered on Seoul City Hall (x = east, z = south).
 * Same frame as the building and road imports, so every layer lines up.
 */
export const ORIGIN_LON = 126.978;
export const ORIGIN_LAT = 37.5665;
const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LON = 111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

const round = (value: number) => Math.round(value * 100) / 100;

export function lonLatToMeters(lon: number, lat: number): [number, number] {
  return [round((lon - ORIGIN_LON) * METERS_PER_DEG_LON), round(-(lat - ORIGIN_LAT) * METERS_PER_DEG_LAT)];
}

/** Inverse of lonLatToMeters. */
export function metersToLonLat(x: number, z: number): [number, number] {
  return [ORIGIN_LON + x / METERS_PER_DEG_LON, ORIGIN_LAT - z / METERS_PER_DEG_LAT];
}
