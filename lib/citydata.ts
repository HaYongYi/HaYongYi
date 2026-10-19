import 'server-only';
import { lonLatToMeters } from './geo';
import type { AreaCongestion } from './congestion';

/**
 * Areas (권역) to show. Names must match Seoul's citydata area names exactly.
 * Add more names here; each one is one API call, cached for a few minutes.
 */
export const CITY_AREAS = ['광화문·덕수궁'];

const BASE_URL = 'http://openapi.seoul.go.kr:8088';
const CACHE_MS = 2 * 60 * 1000;

type Json = Record<string, unknown>;

const cache = new Map<string, { at: number; value: AreaCongestion | null }>();

/**
 * The XML-to-JSON shape nests lists as {NAME: {NAME: [...]}}. Unwrap to the flat items.
 */
function unwrap(node: unknown, key: string): Json[] {
  const list = Array.isArray(node) ? node : node ? [node] : [];
  return list.flatMap((item) => {
    const inner = (item as Json)[key];
    return inner !== undefined ? unwrap(inner, key) : [item as Json];
  });
}

/** Points that sit inside Seoul, so a bad value does not pull the area center away. */
function inSeoul(lon: number, lat: number) {
  return lon > 126.7 && lon < 127.3 && lat > 37.3 && lat < 37.8;
}

/** Collect coordinates of places in the area (parking, subway, bike, charger, bus). */
function collectPoints(city: Json): [number, number][] {
  const sources: [string, string, string, string][] = [
    ['PRK_STTS', 'PRK_STTS', 'LNG', 'LAT'],
    ['SUB_STTS', 'SUB_STTS', 'SUB_STN_X', 'SUB_STN_Y'],
    ['SBIKE_STTS', 'SBIKE_STTS', 'SBIKE_X', 'SBIKE_Y'],
    ['CHARGER_STTS', 'CHARGER_STTS', 'STAT_X', 'STAT_Y'],
    ['BUS_STN_STTS', 'BUS_STN_STTS', 'BUS_STN_X', 'BUS_STN_Y'],
  ];
  const points: [number, number][] = [];
  for (const [topKey, innerKey, xKey, yKey] of sources) {
    for (const item of unwrap(city[topKey], innerKey)) {
      const lon = Number(item[xKey]);
      const lat = Number(item[yKey]);
      if (Number.isFinite(lon) && Number.isFinite(lat) && inSeoul(lon, lat)) points.push([lon, lat]);
    }
  }
  return points;
}

async function fetchArea(key: string, name: string): Promise<AreaCongestion | null> {
  const url = `${BASE_URL}/${key}/json/citydata/1/5/${encodeURIComponent(name)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const json = (await response.json()) as Json;
  // Some responses wrap CITYDATA in SeoulRtd.citydata, others put it at the top level.
  // Each may also be a one-item array.
  const city = unwrap(json['SeoulRtd.citydata'] ?? json, 'CITYDATA')[0];
  if (!city || city.LIVE_PPLTN_STTS === undefined) {
    throw new Error(`unexpected response shape: ${JSON.stringify(json).slice(0, 300)}`);
  }

  const live = unwrap(city.LIVE_PPLTN_STTS, 'LIVE_PPLTN_STTS')[0];
  const points = collectPoints(city);
  if (!live || points.length === 0) return null;

  const lon = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const lat = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const [x, z] = lonLatToMeters(lon, lat);

  return {
    name,
    level: String(live.AREA_CONGESTION_LVL ?? ''),
    min: Number(live.AREA_PPLTN_MIN) || 0,
    max: Number(live.AREA_PPLTN_MAX) || 0,
    x,
    z,
  };
}

async function getArea(key: string, name: string): Promise<AreaCongestion | null> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  try {
    const value = await fetchArea(key, name);
    cache.set(name, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.error(`[citydata] ${name} failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Current congestion for every area in CITY_AREAS. Returns [] when the key is not set,
 * so the rest of the map still works.
 */
export async function loadCongestion(): Promise<AreaCongestion[]> {
  const key = process.env.SEOUL_OPEN_API_KEY;
  if (!key) return [];

  const results = await Promise.all(CITY_AREAS.map((name) => getArea(key, name)));
  return results.filter((area): area is AreaCongestion => area !== null);
}
