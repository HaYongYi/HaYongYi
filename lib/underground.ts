/**
 * Facilities that exist underground. Any name containing one of these words is moved to the
 * underground layer. Matching on the shared root 지하 covers the whole list below:
 *
 *   Transit:    지하철(역), 지하도, 지하보도, 지하차도, 지하통로
 *   Commercial: 지하상가, 지하주차장, 지하쇼핑센터, 지하공간
 *   Utilities:  지하변전소, 지하저수조, 지하화(도로 지하화), 지하수
 *
 * Caveat: a name like "OO빌딩 지하주차장동" also has an above-ground part, which this rule
 * hides from the building layer.
 */
export const UNDERGROUND_KEYWORDS = ['지하'];

export function isUndergroundName(name: string): boolean {
  return UNDERGROUND_KEYWORDS.some((keyword) => name.includes(keyword));
}

/** Depth used when a facility is underground by name but has no floor count (about one floor). */
export const DEFAULT_UNDERGROUND_DEPTH = 3.3;
