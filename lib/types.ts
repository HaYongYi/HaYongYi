/**
 * A single building in the city model.
 *
 * Coordinates are in meters on the city's ground plane (x = east, z = south).
 * `x`/`z` is the reference point for the building (its centroid).
 *
 * If `footprint` is present, it is the outer ring as [x, z] pairs in the same
 * meter space and the building is extruded from it up to `height`.
 * Otherwise the building is drawn as an axis-aligned box of `width` x `depth`.
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
  /** Outer ring of the footprint as [x, z] pairs in meters (optional). */
  footprint?: [number, number][];
}
