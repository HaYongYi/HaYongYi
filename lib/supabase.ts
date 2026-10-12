import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Building, Road } from './types';
import { createSampleCity, createSampleRoads } from './sample-city';

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
    supabase
      .from('buildings')
      .select('id, name, usage, x, z, width, depth, height, color, footprint, basement_depth')
      .order('id'),
    supabase.from('roads').select('id, name, width, points').order('id'),
  ]);

  if (buildingsResult.error) {
    console.error('[loadCity] Supabase buildings query failed:', buildingsResult.error.message);
    return { buildings: createSampleCity(), roads: createSampleRoads(), source: 'sample' };
  }

  if (roadsResult.error) {
    console.error('[loadCity] Supabase roads query failed:', roadsResult.error.message);
  }

  return {
    buildings: (buildingsResult.data as BuildingRow[]).map((row) => ({
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
      basementDepth: row.basement_depth > 0 ? row.basement_depth : undefined,
    })),
    roads: roadsResult.error
      ? []
      : (roadsResult.data as RoadRow[]).map((row) => ({
          id: row.id,
          name: row.name,
          width: row.width,
          points: row.points,
        })),
    source: 'supabase',
  };
}
