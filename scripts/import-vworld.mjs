#!/usr/bin/env node
/**
 * Imports building footprints for a Seoul bounding box from VWorld (브이월드)
 * and writes an SQL file that upserts them into the Supabase `buildings` table.
 *
 * Run on your own machine (needs network access to api.vworld.kr):
 *
 *   VWORLD_API_KEY=your-key npm run import:seoul
 *
 * Optional environment variables:
 *   VWORLD_DOMAIN   domain registered with the key, if the key requires one
 *   BBOX            "minLon,minLat,maxLon,maxLat" (default: Jung/Jongno, about 6 x 5 km)
 *   LAYER           WFS type name (default: lt_c_spbd, building polygons)
 *   FLOORS_FIELD    property holding above-ground floor count (default: gro_flo_co)
 *   FLOOR_HEIGHT    meters per floor used for the height estimate (default: 3.3)
 *   BASEMENT_FIELD  property holding below-ground floor count (default: und_flo_co)
 *   NAME_BASEMENT_FLOORS  assumed basement floors when the name contains 지하 but the
 *                   floor count is empty (default: 1)
 *   HEIGHT_FIELD    optional property holding height in meters, takes precedence if set
 *   ID_FIELD        property used as a stable id (default: bd_mgt_sn)
 *   NAME_FIELD      property holding the building name (default: buld_nm)
 *   USAGE_FIELD     property holding the usage label (optional)
 *   MAX_FEATURES    per-request cap (default: 1000); the box is split automatically
 *   OUT             output path (default: supabase/seed-seoul.sql)
 *   UPLOAD=1        upload straight to Supabase instead of writing SQL. Needs
 *                   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   ROWS_PER_FILE   rows per SQL file; larger sets are split into -001, -002, ... (default: 2000)
 *
 * The property names above are defaults. Confirm them against the layer's
 * schema before a large import:
 *   https://api.vworld.kr/req/wfs?service=WFS&version=1.1.0&request=DescribeFeatureType&typename=lt_c_spbd&key=YOUR_KEY
 */

import { fetchAllFeatures } from './lib/vworld-wfs.mjs';
import { writeSqlChunks } from './lib/sql-chunks.mjs';
import { dedupeById, uploadRequested, upsertRows } from './lib/supabase-upload.mjs';

const env = process.env;
const apiKey = env.VWORLD_API_KEY;
if (!apiKey) {
  console.error('VWORLD_API_KEY is required. Get a key at https://www.vworld.kr (Open API → 발급).');
  process.exit(1);
}

const bbox = (env.BBOX ?? '126.945,37.545,127.015,37.590').split(',').map(Number);
if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
  console.error('BBOX must be "minLon,minLat,maxLon,maxLat".');
  process.exit(1);
}

const LAYER = env.LAYER ?? 'lt_c_spbd';
// The lt_c_spbd layer has no height attribute, so height is estimated from the
// above-ground floor count. Underground floors (und_flo_co) are not part of the height.
const HEIGHT_FIELD = env.HEIGHT_FIELD;
const FLOORS_FIELD = env.FLOORS_FIELD ?? 'gro_flo_co';
const BASEMENT_FIELD = env.BASEMENT_FIELD ?? 'und_flo_co';
const FLOOR_HEIGHT = Number(env.FLOOR_HEIGHT ?? 3.3);
const NAME_BASEMENT_FLOORS = Number(env.NAME_BASEMENT_FLOORS ?? 1);
const ID_FIELD = env.ID_FIELD ?? 'bd_mgt_sn';
const NAME_FIELD = env.NAME_FIELD ?? 'buld_nm';
const USAGE_FIELD = env.USAGE_FIELD;
const MAX_FEATURES = Number(env.MAX_FEATURES ?? 1000);
const OUT = env.OUT ?? 'supabase/seed-seoul.sql';
const ROWS_PER_FILE = Number(env.ROWS_PER_FILE ?? 2000);
const DEFAULT_HEIGHT = 10;

// Local meter frame centered on Seoul City Hall, matching the viewer's coordinates.
const ORIGIN_LON = 126.978;
const ORIGIN_LAT = 37.5665;
const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LON = 111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

const round = (value) => Math.round(value * 100) / 100;
const project = ([lon, lat]) => [
  round((lon - ORIGIN_LON) * METERS_PER_DEG_LON),
  round(-(lat - ORIGIN_LAT) * METERS_PER_DEG_LAT),
];
const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Polygon rings to import. MultiPolygon features contribute every part, not only the first. */
function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon[0]);
  return [];
}

function toRows(feature, index) {
  const props = feature.properties ?? {};
  // feature.id is unique per WFS layer. The building management number is not always unique.
  const rawId = feature.id ?? props[ID_FIELD] ?? `row-${index}`;
  const floors = Number(props[FLOORS_FIELD]);
  const measured = HEIGHT_FIELD ? Number(props[HEIGHT_FIELD]) : NaN;
  let height = DEFAULT_HEIGHT;
  if (measured > 0) height = round(measured);
  else if (floors > 0) height = round(floors * FLOOR_HEIGHT);
  const name = props[NAME_FIELD] || `Building ${rawId}`;
  const usage = (USAGE_FIELD && props[USAGE_FIELD]) || 'unknown';
  const basements = Number(props[BASEMENT_FIELD]);
  // Names like "지하주차장" or "지하상가" mark underground space even without a floor count.
  // 지하철 is excluded because it is a station name, not a building underground.
  const namedUnderground = name.includes('지하') && !name.includes('지하철');
  let basementDepth = 0;
  if (basements > 0) basementDepth = round(basements * FLOOR_HEIGHT);
  else if (namedUnderground) basementDepth = round(NAME_BASEMENT_FLOORS * FLOOR_HEIGHT);

  return outerRings(feature.geometry)
    .filter((ring) => ring && ring.length >= 4)
    .map((ring, part, parts) => {
      const footprint = ring.slice(0, -1).map(project); // drop the closing duplicate point
      const xs = footprint.map(([x]) => x);
      const zs = footprint.map(([, z]) => z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      return {
        id: parts.length > 1 ? `vw-${rawId}-${part}` : `vw-${rawId}`,
        name,
        usage,
        x: round((minX + maxX) / 2),
        z: round((minZ + maxZ) / 2),
        width: Math.max(round(maxX - minX), 0.5),
        depth: Math.max(round(maxZ - minZ), 0.5),
        height,
        color: '#b8bfc8',
        footprint,
        basementDepth,
      };
    });
}

/** Map a row to the buildings table's column names for the REST upload. */
function toDbRow(r) {
  return {
    id: r.id,
    name: r.name,
    usage: r.usage,
    x: r.x,
    z: r.z,
    width: r.width,
    depth: r.depth,
    height: r.height,
    color: r.color,
    footprint: r.footprint,
    basement_depth: r.basementDepth,
  };
}

function toSql(rows) {
  const header = [
    `-- Generated by scripts/import-vworld.mjs from VWorld layer ${LAYER}`,
    `-- BBOX ${bbox.join(',')}; ${rows.length} buildings`,
    '',
  ];
  const values = rows.map(
    (r) =>
      `(${[
        sqlString(r.id),
        sqlString(r.name),
        sqlString(r.usage),
        r.x,
        r.z,
        r.width,
        r.depth,
        r.height,
        sqlString(r.color),
        `${sqlString(JSON.stringify(r.footprint))}::jsonb`,
        r.basementDepth,
      ].join(', ')})`,
  );
  return [
    ...header,
    'insert into public.buildings (id, name, usage, x, z, width, depth, height, color, footprint, basement_depth) values',
    values.join(',\n'),
    'on conflict (id) do update set',
    '  name = excluded.name, usage = excluded.usage, x = excluded.x, z = excluded.z,',
    '  width = excluded.width, depth = excluded.depth, height = excluded.height,',
    '  color = excluded.color, footprint = excluded.footprint, basement_depth = excluded.basement_depth;',
    '',
  ].join('\n');
}

const features = await fetchAllFeatures({
  layer: LAYER,
  bbox,
  apiKey,
  domain: env.VWORLD_DOMAIN,
  maxFeatures: MAX_FEATURES,
});

const perFeature = features.map(toRows);
const deduped = dedupeById(perFeature.flat());
const rows = deduped.rows;
if (deduped.dropped > 0) console.warn(`Dropped ${deduped.dropped} duplicate building ids.`);
const skipped = perFeature.filter((parts) => parts.length === 0).length;
if (skipped > 0) console.warn(`Skipped ${skipped} features without a usable polygon.`);
if (rows.length === 0) {
  console.error('No buildings to write. Check BBOX and the layer name.');
  process.exit(1);
}

// Warn when every height falls back to the default, which means the floor field is missing or misnamed.
const defaulted = rows.filter((r) => r.height === DEFAULT_HEIGHT).length;
if (defaulted === rows.length) {
  console.warn(`Every building got the default height (${DEFAULT_HEIGHT}m). Check FLOORS_FIELD="${FLOORS_FIELD}".`);
} else {
  console.log(`${defaulted} of ${rows.length} buildings have no floor count and use the default height.`);
}

if (uploadRequested(env)) {
  await upsertRows(env, 'buildings', rows.map(toDbRow));
  console.log(`Uploaded ${rows.length} buildings to Supabase.`);
} else {
  const written = await writeSqlChunks(OUT, rows, toSql, ROWS_PER_FILE);
  console.log(`Wrote ${rows.length} buildings to ${written.length} file(s):`);
  for (const path of written) console.log(`  ${path}`);
}
if (!uploadRequested(env)) console.log('Next: paste the file into the Supabase SQL editor and run it.');
