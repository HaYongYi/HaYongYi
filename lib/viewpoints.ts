import { lonLatToMeters } from './geo';

/**
 * Representative viewpoints for the skyline study. Coordinates are approximate
 * (within tens of meters); adjust lon/lat here if a point should sit elsewhere.
 */
export interface NamedViewpoint {
  key: string;
  name: string;
  lon: number;
  lat: number;
  x: number;
  z: number;
}

const RAW: { key: string; name: string; lon: number; lat: number }[] = [
  { key: 'gwanghwamun', name: '광화문광장', lon: 126.9768, lat: 37.572 },
  { key: 'namdaemun', name: '남대문(숭례문)', lon: 126.9753, lat: 37.56 },
  { key: 'euljiro', name: '을지로입구', lon: 126.9826, lat: 37.566 },
  { key: 'cheonggye', name: '청계광장', lon: 126.978, lat: 37.569 },
];

export const VIEWPOINTS: NamedViewpoint[] = RAW.map((v) => {
  const [x, z] = lonLatToMeters(v.lon, v.lat);
  return { ...v, x, z };
});
