import type { Building } from './types';

/**
 * Building categories, used for color. Classified by name keywords for now.
 * 기타 (other) keeps the building's own color.
 */
export type BuildingCategory = '교통' | '주거' | '상업' | '업무' | '기타';

export const CATEGORY_COLORS: Record<Exclude<BuildingCategory, '기타'>, string> = {
  교통: '#7d8fa9',
  주거: '#e3cfa1',
  상업: '#d9826f',
  업무: '#8aa0b6',
};

/** Display order for the legend. */
export const CATEGORY_ORDER: BuildingCategory[] = ['교통', '주거', '상업', '업무', '기타'];

/** Swatch color per category, including 기타 (its own color on the map, a neutral gray in the legend). */
export const CATEGORY_SWATCH: Record<BuildingCategory, string> = { ...CATEGORY_COLORS, 기타: '#b8bfc8' };

/** First matching rule wins. Substring match on the building name. */
const NAME_RULES: [Exclude<BuildingCategory, '기타'>, string[]][] = [
  ['교통', ['지하철역', '역사', '터미널', '버스', '정류장', '차고지']],
  ['주거', ['아파트', '주택', '빌라', '오피스텔', '맨션', '연립', '다세대']],
  ['상업', ['상가', '마트', '백화점', '쇼핑', '시장', '호텔']],
  ['업무', ['빌딩', '타워', '오피스', '센터', '금융']],
];

export function categorize(building: Building): BuildingCategory {
  for (const [category, words] of NAME_RULES) {
    if (words.some((word) => building.name.includes(word))) return category;
  }
  return '기타';
}

/** Color to draw a building with: its category color, or its own color for 기타. */
export function categoryColor(building: Building): string {
  const category = categorize(building);
  return category === '기타' ? building.color : CATEGORY_COLORS[category];
}
