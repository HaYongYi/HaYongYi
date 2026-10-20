// Converts a DEM in ESRI ASCII Grid form (EPSG:5186, meters) into the viewer's city frame.
// Usage: node scripts/import-dem.mjs <seoul_dem.asc> [output.json]
// Writes public/terrain/seoul-dem.json by default. Run it on the PC that holds the .asc file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Same city frame as lib/geo.ts (x = east, z = south, origin at Seoul City Hall)
const ORIGIN_LON = 126.978;
const ORIGIN_LAT = 37.5665;
const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LON = 111_320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

// Korea 2000 / Central Belt (EPSG:5186): GRS80 Transverse Mercator
const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 1;
const LON0 = (127 * Math.PI) / 180;
const LAT0 = (38 * Math.PI) / 180;
const FE = 200000;
const FN = 600000;

const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));

function meridianArc(phi) {
  return (
    A *
    ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi))
  );
}

const M0 = meridianArc(LAT0);

/** Inverse Transverse Mercator: easting/northing in meters -> [lon, lat] in degrees. */
export function tmToLonLat(easting, northing) {
  const M = M0 + (northing - FN) / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * E1 ** 2) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * E1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * E1 ** 4) / 512) * Math.sin(8 * mu);

  const sinP = Math.sin(phi1);
  const cosP = Math.cos(phi1);
  const tanP = Math.tan(phi1);
  const N1 = A / Math.sqrt(1 - E2 * sinP ** 2);
  const T1 = tanP ** 2;
  const C1 = EP2 * cosP ** 2;
  const R1 = (A * (1 - E2)) / (1 - E2 * sinP ** 2) ** 1.5;
  const D = (easting - FE) / (N1 * K0);

  const lat =
    phi1 -
    ((N1 * tanP) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    LON0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5) / 120) /
      cosP;

  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

function toCityMeters(lon, lat) {
  return [(lon - ORIGIN_LON) * METERS_PER_DEG_LON, -(lat - ORIGIN_LAT) * METERS_PER_DEG_LAT];
}

function main() {
  const [input, output = 'public/terrain/seoul-dem.json'] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node scripts/import-dem.mjs <seoul_dem.asc> [output.json]');
    process.exit(1);
  }

  const lines = readFileSync(input, 'utf8').split(/\r?\n/);
  const header = {};
  let dataStart = 0;
  for (; dataStart < lines.length; dataStart++) {
    const [key, value] = lines[dataStart].trim().split(/\s+/);
    if (!key || !Number.isNaN(Number(key))) break;
    header[key.toLowerCase()] = Number(value);
  }

  const { ncols, nrows, xllcorner, yllcorner, cellsize } = header;
  const noData = header.nodata_value;
  const values = lines.slice(dataStart).join(' ').trim().split(/\s+/).map(Number);
  if (values.length !== ncols * nrows) {
    throw new Error(`expected ${ncols * nrows} values, found ${values.length}`);
  }

  // ASCII grids list the northern row first. Cell centers are given in EPSG:5186 meters.
  const cell = (row, col) => {
    const easting = xllcorner + (col + 0.5) * cellsize;
    const northing = yllcorner + (nrows - row - 0.5) * cellsize;
    return toCityMeters(...tmToLonLat(easting, northing));
  };
  const [originX, originZ] = cell(0, 0);
  const [lastX, lastZ] = cell(nrows - 1, ncols - 1);
  const stepX = (lastX - originX) / (ncols - 1);
  const stepZ = (lastZ - originZ) / (nrows - 1);

  let missing = 0;
  const heights = values.map((value) => {
    if (value === noData || !Number.isFinite(value)) {
      missing++;
      return 0;
    }
    return Math.round(value * 10) / 10;
  });

  const result = { ncols, nrows, originX, originZ, stepX, stepZ, heights };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result));
  console.log(`wrote ${output}: ${ncols} x ${nrows} cells, step ${stepX.toFixed(1)} x ${stepZ.toFixed(1)} m`);
  if (missing > 0) console.warn(`${missing} cells had no data and were set to 0 m`);
}

if (process.argv[1]?.endsWith('import-dem.mjs')) main();
