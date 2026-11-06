/**
 * Shared VWorld WFS helpers for the import scripts.
 *
 * VWorld caps each GetFeature response (maxFeatures). To get everything inside a
 * bounding box, fetchAllFeatures() splits the box into quadrants whenever a response
 * comes back full, and de-duplicates features that cross tile edges.
 */

const WFS_URL = 'https://api.vworld.kr/req/wfs';
const REQUEST_DELAY_MS = 150;
const MAX_SPLIT_DEPTH = 6;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Build the BBOX value. EPSG:4326 is lat/lon order in WFS 1.1.0 per OGC; some servers want lon/lat. */
function bboxParam([minLon, minLat, maxLon, maxLat], order) {
  return order === 'latlon'
    ? `${minLat},${minLon},${maxLat},${maxLon},EPSG:4326`
    : `${minLon},${minLat},${maxLon},${maxLat},EPSG:4326`;
}

async function requestTile({ layer, apiKey, domain, maxFeatures }, bbox, order) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.1.0',
    request: 'GetFeature',
    typename: layer,
    srsName: 'EPSG:4326',
    output: 'application/json',
    bbox: bboxParam(bbox, order),
    maxFeatures: String(maxFeatures),
    key: apiKey,
  });
  if (domain) params.set('domain', domain);

  const response = await fetch(`${WFS_URL}?${params}`);
  const text = await response.text();

  // VWorld returns XML error documents, so parse and check the body, not only the status.
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Expected GeoJSON from VWorld but got:\n${text.slice(0, 400)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);

  await sleep(REQUEST_DELAY_MS);
  return json.features ?? [];
}

function quadrants([minLon, minLat, maxLon, maxLat]) {
  const midLon = (minLon + maxLon) / 2;
  const midLat = (minLat + maxLat) / 2;
  return [
    [minLon, minLat, midLon, midLat],
    [midLon, minLat, maxLon, midLat],
    [minLon, midLat, midLon, maxLat],
    [midLon, midLat, maxLon, maxLat],
  ];
}

/**
 * Returns every feature in `bbox` for `layer`, split into tiles as needed.
 * @param {object} options
 * @param {string} options.layer       WFS typename, e.g. lt_c_spbd
 * @param {number[]} options.bbox      [minLon, minLat, maxLon, maxLat]
 * @param {string} options.apiKey
 * @param {string} [options.domain]    registered domain, if the key needs one
 * @param {number} options.maxFeatures per-request cap (VWorld limit for this key)
 */
export async function fetchAllFeatures(options) {
  const { bbox, maxFeatures } = options;

  // Detect the axis order once on the full box: lon,lat first, then lat,lon.
  let order = 'lonlat';
  let probe = await requestTile(options, bbox, order);
  if (probe.length === 0) {
    console.warn('0 features with lon,lat bbox order. Retrying with lat,lon order...');
    probe = await requestTile(options, bbox, 'latlon');
    if (probe.length > 0) order = 'latlon';
  }

  const unique = new Map();
  let requests = 0;

  async function collect(box, depth) {
    // The root tile was already fetched while detecting axis order.
    const features = depth === 0 ? probe : await requestTile(options, box, order);
    requests++;

    if (features.length < maxFeatures || depth >= MAX_SPLIT_DEPTH) {
      if (features.length >= maxFeatures) {
        console.warn(`Tile hit the cap at depth ${depth}; some features may be missing.`);
      }
      for (const feature of features) {
        const key = feature.id ?? JSON.stringify(feature.properties ?? {});
        if (!unique.has(key)) unique.set(key, feature);
      }
      return;
    }

    for (const sub of quadrants(box)) {
      await collect(sub, depth + 1);
    }
  }

  await collect(bbox, 0);
  console.log(`Fetched ${unique.size} unique features in ${requests} requests (axis order: ${order})`);
  return [...unique.values()];
}
