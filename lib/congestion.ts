/**
 * Real-time population congestion for one area (권역), from the Seoul citydata API.
 * Safe to import from client components: no server-only code here.
 */
export interface AreaCongestion {
  name: string;
  /** Seoul's label, e.g. 여유, 보통, 약간 붐빔, 붐빔, 매우 붐빔 */
  level: string;
  min: number;
  max: number;
  /** Area center in the city's meter frame */
  x: number;
  z: number;
}

/** Levels from least to most crowded. */
export const CONGESTION_LEVELS = ['여유', '보통', '약간 붐빔', '붐빔', '매우 붐빔'] as const;

export const CONGESTION_COLORS: Record<(typeof CONGESTION_LEVELS)[number], string> = {
  여유: '#7cc7a0',
  보통: '#f2db6b',
  '약간 붐빔': '#f0a04b',
  붐빔: '#e4572e',
  '매우 붐빔': '#a4161a',
};

const UNKNOWN_COLOR = '#b0b8c4';

/** Matching ignores spaces, so "약간붐빔" and "약간 붐빔" are the same level. */
function normalizeLevel(level: string): string {
  return level.replace(/\s+/g, '');
}

/** The level as Seoul spells it, or null when it is not one of CONGESTION_LEVELS. */
export function matchLevel(level: string): (typeof CONGESTION_LEVELS)[number] | null {
  const key = normalizeLevel(level);
  return CONGESTION_LEVELS.find((known) => normalizeLevel(known) === key) ?? null;
}

export function congestionColor(level: string): string {
  const matched = matchLevel(level);
  return matched ? CONGESTION_COLORS[matched] : UNKNOWN_COLOR;
}
