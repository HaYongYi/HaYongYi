import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Building } from './types';
import { createSampleCity } from './sample-city';

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
}

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

export interface LoadedCity {
  buildings: Building[];
  source: 'supabase' | 'sample';
}

/**
 * Loads buildings from Supabase when configured; otherwise returns the sample city.
 * Errors from Supabase are logged and also fall back to the sample so the page still renders.
 */
export async function loadCity(): Promise<LoadedCity> {
  const supabase = getSupabase();
  if (!supabase) {
    return { buildings: createSampleCity(), source: 'sample' };
  }

  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, usage, x, z, width, depth, height, color, footprint')
    .order('id');

  if (error) {
    console.error('[loadCity] Supabase query failed:', error.message);
    return { buildings: createSampleCity(), source: 'sample' };
  }

  return {
    buildings: (data as BuildingRow[]).map((row) => ({
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
    })),
    source: 'supabase',
  };
}
