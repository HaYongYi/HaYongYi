import { elevationAt, type ElevationGrid } from './elevation';
import type { Road } from './types';

export interface Shelter {
  name: string;
  x: number;
  z: number;
}

export interface EvacuationRoute {
  /** Route corners in the city meter frame, from the start to the shelter */
  path: [number, number][];
  shelter: Shelter;
  /** Length along the roads in meters */
  length: number;
}

/** Minimal binary heap keyed by distance, for Dijkstra. */
class MinHeap {
  private items: [number, number][] = [];

  get size() {
    return this.items.length;
  }

  push(item: [number, number]) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Shortest road route from `start` to the nearest reachable shelter. Roads whose ends lie below
 * the water level are dropped, so the route avoids submerged streets. Returns null when no
 * shelter can be reached.
 */
export function findEvacuationRoute(
  start: [number, number],
  shelters: Shelter[],
  roads: Road[],
  grid: ElevationGrid | null,
  waterLevel: number,
): EvacuationRoute | null {
  const isDry = (x: number, z: number) => !grid || elevationAt(grid, x, z) >= waterLevel;

  // Road graph: one node per dry polyline vertex, one edge per dry segment
  const nodeIndex = new Map<string, number>();
  const xs: number[] = [];
  const zs: number[] = [];
  const adjacency: { to: number; length: number }[][] = [];
  const nodeOf = (x: number, z: number) => {
    const key = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    let index = nodeIndex.get(key);
    if (index === undefined) {
      index = xs.length;
      nodeIndex.set(key, index);
      xs.push(x);
      zs.push(z);
      adjacency.push([]);
    }
    return index;
  };
  for (const road of roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const [x0, z0] = road.points[i];
      const [x1, z1] = road.points[i + 1];
      if (!isDry(x0, z0) || !isDry(x1, z1)) continue;
      const a = nodeOf(x0, z0);
      const b = nodeOf(x1, z1);
      if (a === b) continue;
      const length = Math.hypot(x1 - x0, z1 - z0);
      adjacency[a].push({ to: b, length });
      adjacency[b].push({ to: a, length });
    }
  }

  const nearestNode = (x: number, z: number) => {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (adjacency[i].length === 0) continue;
      const distance = Math.hypot(xs[i] - x, zs[i] - z);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  };

  const startNode = nearestNode(start[0], start[1]);
  if (startNode < 0) return null;

  // Shelter nodes: the nearest dry road node to each shelter
  const targets = new Map<number, Shelter>();
  for (const shelter of shelters) {
    const node = nearestNode(shelter.x, shelter.z);
    if (node >= 0 && !targets.has(node)) targets.set(node, shelter);
  }
  if (targets.size === 0) return null;

  // Dijkstra from the start until the first shelter is reached
  const distance = new Float64Array(xs.length).fill(Infinity);
  const previous = new Int32Array(xs.length).fill(-1);
  distance[startNode] = 0;
  const heap = new MinHeap();
  heap.push([0, startNode]);
  while (heap.size > 0) {
    const [d, node] = heap.pop()!;
    if (d > distance[node]) continue;
    const shelter = targets.get(node);
    if (shelter) {
      const path: [number, number][] = [];
      for (let at = node; at >= 0; at = previous[at]) path.push([xs[at], zs[at]]);
      path.reverse();
      return { path, shelter, length: d };
    }
    for (const edge of adjacency[node]) {
      const next = d + edge.length;
      if (next < distance[edge.to]) {
        distance[edge.to] = next;
        previous[edge.to] = node;
        heap.push([next, edge.to]);
      }
    }
  }
  return null;
}
