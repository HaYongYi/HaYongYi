/**
 * A single building in the city model.
 *
 * Coordinates are in meters on the city's ground plane (x = east, z = south).
 * The footprint is an axis-aligned rectangle centered on (x, z).
 */
export interface Building {
  id: string;
  name: string;
  usage: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** CSS hex color, e.g. "#8fa3b8" */
  color: string;
}
