import type { Building } from './types';

/** Mulberry32: small deterministic PRNG so server and client render the same city. */
function createRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USAGES = [
  { usage: 'residential', colors: ['#d9c9a3', '#c9b48a', '#e6d7b8'] },
  { usage: 'office', colors: ['#8fa3b8', '#7b8fa6', '#a7b8c9'] },
  { usage: 'commercial', colors: ['#c98b7a', '#d6a08f', '#b87565'] },
  { usage: 'park', colors: ['#6f9e6a'] },
] as const;

/** L-shaped outer ring inside the w x d box centered on (x, z). */
function lShape(x: number, z: number, w: number, d: number): [number, number][] {
  const hw = w / 2;
  const hd = d / 2;
  return [
    [x - hw, z - hd],
    [x + hw, z - hd],
    [x + hw, z],
    [x, z],
    [x, z + hd],
    [x - hw, z + hd],
  ];
}

/**
 * Generates a grid-based sample city. Used when Supabase is not configured,
 * so the viewer is usable immediately after cloning.
 */
export function createSampleCity(seed = 42): Building[] {
  const random = createRandom(seed);
  const blocks = 6;
  const blockSize = 120;
  const street = 24;
  const buildings: Building[] = [];
  let index = 0;

  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      const originX = (bx - blocks / 2) * (blockSize + street);
      const originZ = (bz - blocks / 2) * (blockSize + street);
      const isCentralBlock = Math.abs(bx - blocks / 2 + 0.5) < 1.5 && Math.abs(bz - blocks / 2 + 0.5) < 1.5;
      const usageSlot = USAGES[Math.floor(random() * USAGES.length)];
      const isPark = usageSlot.usage === 'park' || (!isCentralBlock && random() < 0.08);

      if (isPark) {
        index++;
        buildings.push({
          id: `sample-${index}`,
          name: `Park ${bx}-${bz}`,
          usage: 'park',
          x: originX + blockSize / 2,
          z: originZ + blockSize / 2,
          width: blockSize * 0.9,
          depth: blockSize * 0.9,
          height: 0.4,
          color: USAGES[3].colors[0],
        });
        continue;
      }

      const cols = 2 + Math.floor(random() * 2);
      const rows = 2 + Math.floor(random() * 2);
      const cellW = blockSize / cols;
      const cellD = blockSize / rows;

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (random() < 0.15) continue;
          index++;
          const kind = isCentralBlock && random() < 0.6 ? USAGES[1] : USAGES[Math.floor(random() * 3)];
          const palette = kind.colors;
          const tall = isCentralBlock ? 60 + random() * 140 : 12 + random() * 50;
          const width = cellW * (0.55 + random() * 0.3);
          const depth = cellD * (0.55 + random() * 0.3);
          const x = originX + cellW * (c + 0.5);
          const z = originZ + cellD * (r + 0.5);

          buildings.push({
            id: `sample-${index}`,
            name: `${kind.usage[0].toUpperCase()}${kind.usage.slice(1)} ${index}`,
            usage: kind.usage,
            x,
            z,
            width,
            depth,
            height: Math.round(tall),
            color: palette[Math.floor(random() * palette.length)],
            // Roughly 1 in 3 buildings get an L-shaped footprint to exercise polygon rendering.
            footprint: random() < 0.33 ? lShape(x, z, width, depth) : undefined,
          });
        }
      }
    }
  }

  return buildings;
}
