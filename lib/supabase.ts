import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Building, Road } from './types';
import { createSampleCity, createSampleRoads } from './sample-city';
import { DEFAULT_UNDERGROUND_DEPTH, isUndergroundName } from './underground';

/** Row shape of the `buildings` table (snake_case, see supabase/schema.sql). */
interface BuildingRow {
  id: string;
  name: string;
  usage: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  footprint: [number, number][] | null;
  basement_depth: number;
}

/** Row shape of the `roads` table. */
interface RoadRow {
  id: string;
  name: string;
  width: number;
  points: [number, number][];
}

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

/** Supabase returns at most 1000 rows per request by default, so read in pages until done. */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(supabase: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    // Order by id so pages do not overlap or skip rows between requests
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) return Promise.reject(error);
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface LoadedCity {
  buildings: Building[];
  roads: Road[];
  source: 'supabase' | 'sample';
}

/**
 * Loads buildings and roads from Supabase when configured; otherwise returns the sample city.
 * A failed buildings query falls back to the sample city. A failed roads query only drops
 * the roads, so buildings still render (for example, before schema.sql has been run for roads).
 */
export async function loadCity(): Promise<LoadedCity> {
  const supabase = getSupabase();
  if (!supabase) {
    return { buildings: createSampleCity(), roads: createSampleRoads(), source: 'sample' };
  }

  const [buildingsResult, roadsResult] = await Promise.all([
    fetchAllRows<BuildingRow>(supabase, 'buildings', 'id, name, usage, x, z, width, depth, height, color, footprint, basement_depth').then(
      (data) => ({ data, error: null as string | null }),
      (error: { message: string }) => ({ data: [] as BuildingRow[], error: error.message }),
    ),
    fetchAllRows<RoadRow>(supabase, 'roads', 'id, name, width, points').then(
      (data) => ({ data, error: null as string | null }),
      (error: { message: string }) => ({ data: [] as RoadRow[], error: error.message }),
    ),
  ]);

  if (buildingsResult.error) {
    console.error('[loadCity] Supabase buildings query failed:', buildingsResult.error);
    return { buildings: createSampleCity(), roads: createSampleRoads(), source: 'sample' };
  }

  if (roadsResult.error) {
    console.error('[loadCity] Supabase roads query failed:', roadsResult.error);
  }

  return {
    buildings: buildingsResult.data.map((row) => {
      const underground = isUndergroundName(row.name);
      // Underground-by-name facilities without a floor count still get a basement volume
      const basementDepth = row.basement_depth > 0 ? row.basement_depth : underground ? DEFAULT_UNDERGROUND_DEPTH : 0;
      return {
        id: row.id,
        name: row.name,
        usage: row.usage,
        x: row.x,
        z: row.z,
        width: row.width,
        depth: row.depth,
        height: row.height,
        color: row.color,
        footprint: row.footprint ?? undefined,
        basementDepth: basementDepth > 0 ? basementDepth : undefined,
        underground,
      };
    }),
    roads: roadsResult.error
      ? []
      : roadsResult.data.map((row) => ({
          id: row.id,
          name: row.name,
          width: row.width,
          points: row.points,
        })),
    source: 'supabase',
  };
}
