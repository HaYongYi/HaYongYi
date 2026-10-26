'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Building, Road } from '@/lib/types';
import { CATEGORY_ORDER, CATEGORY_SWATCH, categorize, categoryColor, type BuildingCategory } from '@/lib/building-category';
import { CONGESTION_COLORS, CONGESTION_LEVELS, congestionColor, type AreaCongestion } from '@/lib/congestion';
import { areaColor, areaRegions } from '@/lib/area-cells';
import { tilesCovering, type TerrainTile } from '@/lib/terrain-tiles';
import { elevationAt, type ElevationGrid } from '@/lib/elevation';
import { floodScreening, type FloodClass } from '@/lib/flood-risk';
import { submergedCells } from '@/lib/water-level';
import { findEvacuationRoute, type EvacuationRoute, type Shelter } from '@/lib/evacuation';
import { lonLatToMeters } from '@/lib/geo';

interface CityViewerProps {
  buildings: Building[];
  roads?: Road[];
  congestion?: AreaCongestion[];
}

/** Radius of the crowd disc drawn for each area, in meters. */
const CROWD_RADIUS = 350;

/** Road surface sits just above the ground plane so it is not hidden by z-fighting. */
const ROAD_Y = 0.3;
/** Roads are cut into pieces this long (m) so each piece follows the ground. */
const ROAD_PIECE_LENGTH = 10;
const DEFAULT_ROAD_WIDTH = 8;
/** Area tint sits between the roads and the crowd discs. */
const AREA_Y = 0.04;
/** Base map sits just above the ground and under the roads. */
const TERRAIN_Y = 0.01;
/** Satellite imagery sits a little above the base map so it wins if both are on. */
const IMAGERY_Y = 0.015;
/** Flood screening tint sits just above the imagery. */
const FLOOD_Y = 0.05;
const FLOOD_COLORS: Record<FloodClass, string> = { primary: '#d7301f', low: '#8ecae6', dense: '#1d3f8a' };
const FLOOD_LABELS: Record<FloodClass, string> = { primary: '1급 후보 (저지대+밀집)', low: '저지대', dense: '밀집' };
const FLOOD_CLASSES: FloodClass[] = ['primary', 'low', 'dense'];
/** Water surface sits above the other ground layers. */
const WATER_Y = 0.08;
const WATER_COLOR = '#2b7bb9';
/** Water level slider range in meters. */
const WATER_MAX = 50;
const WATER_STEP = 0.5;
const ROAD_COLOR = '#5d6571';
const BASEMENT_COLOR = '#6f9bc2';
const GROUND_OPACITY_WITH_BASEMENT = 0.2;
const BUILDING_OPACITY_WITH_BASEMENT = 0.3;

/** With the basement view on, buildings and ground turn translucent so underground volumes show through. */
function setTranslucent(material: THREE.MeshStandardMaterial, on: boolean, opacity: number) {
  material.transparent = on;
  material.opacity = on ? opacity : 1;
  material.depthWrite = !on;
  material.needsUpdate = true;
}

const BACKGROUND = '#e9edf2';
const HOVER_EMISSIVE = '#4cc9f0';
const SELECTED_EMISSIVE = '#ff7a3d';
/** Pointer travel (px) above which a press is treated as a camera drag, not a click. */
const CLICK_TOLERANCE = 4;

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type BuildingMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/**
 * Solid with its base at y = 0 and its top at y = `height`. Uses the real footprint
 * when available, otherwise a box.
 */
function createPrism(b: Building, height: number): THREE.BufferGeometry {
  if (b.footprint && b.footprint.length >= 3) {
    // Shape lives in the XY plane. After rotating -90° about X, shape y maps to -z,
    // so negate z here to keep the footprint's orientation, and extrude along +y.
    const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x - b.x, -(z - b.z))));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  const geometry = new THREE.BoxGeometry(b.width, height, b.depth);
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/** Bounds of all buildings and road centerlines, so the camera and ground cover both layers. */
function computeBounds(buildings: Building[], roads: Road[]): Bounds {
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const include = (x: number, z: number, margin: number) => {
    bounds.minX = Math.min(bounds.minX, x - margin);
    bounds.maxX = Math.max(bounds.maxX, x + margin);
    bounds.minZ = Math.min(bounds.minZ, z - margin);
    bounds.maxZ = Math.max(bounds.maxZ, z + margin);
  };
  for (const b of buildings) include(b.x, b.z, Math.max(b.width, b.depth) / 2);
  for (const road of roads) {
    for (const [x, z] of road.points) include(x, z, (road.width || DEFAULT_ROAD_WIDTH) / 2);
  }
  if (!Number.isFinite(bounds.minX)) return { minX: -250, maxX: 250, minZ: -250, maxZ: 250 };
  return bounds;
}


/**
 * Turns road centerlines into one flat triangle strip mesh. Each segment becomes a
 * quad offset by half the road width on either side of the line.
 */
function buildRoadGeometry(roads: Road[], elevation: ElevationGrid | null): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const road of roads) {
    const half = (road.width > 0 ? road.width : DEFAULT_ROAD_WIDTH) / 2;
    for (let i = 0; i < road.points.length - 1; i++) {
      const [x0, z0] = road.points[i];
      const [x1, z1] = road.points[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const length = Math.hypot(dx, dz);
      if (length === 0) continue;

      // Unit normal to the segment in the XZ plane, scaled to half the width
      const nx = (-dz / length) * half;
      const nz = (dx / length) * half;
      // Each road corner sits on the ground at its own position
      const lift = (x: number, z: number) => elevationAt(elevation, x, z) + ROAD_Y;
      // Split the segment into short pieces so the road follows hills instead of cutting through them
      const pieces = Math.max(1, Math.ceil(length / ROAD_PIECE_LENGTH));
      for (let k = 0; k < pieces; k++) {
        const t0 = k / pieces;
        const t1 = (k + 1) / pieces;
        const ax = x0 + dx * t0;
        const az = z0 + dz * t0;
        const bx = x0 + dx * t1;
        const bz = z0 + dz * t1;
        const base = positions.length / 3;
        positions.push(
          ax + nx, lift(ax + nx, az + nz), az + nz,
          ax - nx, lift(ax - nx, az - nz), az - nz,
          bx + nx, lift(bx + nx, bz + nz), bz + nz,
          bx - nx, lift(bx - nx, bz - nz), bz - nz,
        );
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Map image layers served by the tile route. */
type TileLayer = 'Base' | 'Satellite';

/** One map tile as a textured grid that follows the ground, corners in the city meter frame. */
function tileGeometry(tile: TerrainTile, elevation: ElevationGrid | null, lift: number): THREE.BufferGeometry {
  const SEGMENTS = 12;
  const { west, east, north, south } = tile;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= SEGMENTS; j++) {
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      const v = j / SEGMENTS; // v = 0 at the north edge
      const x = west + (east - west) * u;
      const z = north + (south - north) * v;
      positions.push(x, elevationAt(elevation, x, z) + lift, z);
      // Image top is north, so the north edge takes texture v = 1
      uvs.push(u, 1 - v);
    }
  }
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * (SEGMENTS + 1) + i;
      const b = a + 1;
      const c = a + SEGMENTS + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * A flat triangle split into a small grid, so the area tint follows hills instead of
 * floating over them. Returns the vertex positions as a flat [x, y, z] list.
 */
function drapeTriangle(a: [number, number], b: [number, number], c: [number, number], elevation: ElevationGrid | null): number[] {
  const N = 8;
  const point = (i: number, j: number) => {
    const x = a[0] + ((b[0] - a[0]) * i + (c[0] - a[0]) * j) / N;
    const z = a[1] + ((b[1] - a[1]) * i + (c[1] - a[1]) * j) / N;
    return [x, elevationAt(elevation, x, z) + AREA_Y, z];
  };
  const out: number[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N - j; i++) {
      out.push(...point(i, j), ...point(i + 1, j), ...point(i, j + 1));
      if (i + j < N - 1) out.push(...point(i + 1, j), ...point(i + 1, j + 1), ...point(i, j + 1));
    }
  }
  return out;
}

/** Relief colors: lowest ground is light green, highest is deep green. */
const LOW_RELIEF_COLOR = '#e4f2b8';
const HIGH_RELIEF_COLOR = '#2f7a3a';

/** The DEM as one mesh: a vertex per grid cell at its real height, colored by that height. */
function reliefGeometry(grid: ElevationGrid): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const minHeight = grid.heights.reduce((min, h) => Math.min(min, h), Infinity);
  const maxHeight = grid.heights.reduce((max, h) => Math.max(max, h), -Infinity);
  const low = new THREE.Color(LOW_RELIEF_COLOR);
  const high = new THREE.Color(HIGH_RELIEF_COLOR);
  const color = new THREE.Color();
  for (let r = 0; r < grid.nrows; r++) {
    for (let c = 0; c < grid.ncols; c++) {
      const height = grid.heights[r * grid.ncols + c];
      positions.push(grid.originX + c * grid.stepX, height, grid.originZ + r * grid.stepZ);
      const t = maxHeight > minHeight ? (height - minHeight) / (maxHeight - minHeight) : 0;
      color.copy(low).lerp(high, t);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let r = 0; r < grid.nrows - 1; r++) {
    for (let c = 0; c < grid.ncols - 1; c++) {
      const a = r * grid.ncols + c;
      const b = a + 1;
      const d = a + grid.ncols;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type LayerKey =
  | 'buildings'
  | 'roads'
  | 'basement'
  | 'crowd'
  | 'areas'
  | 'terrain'
  | 'satellite'
  | 'relief'
  | 'flood'
  | 'water'
  | 'shelter';
type LayerState = Record<LayerKey, boolean>;
type CategoryState = Record<BuildingCategory, boolean>;

const DEFAULT_CATEGORIES: CategoryState = { 교통: true, 주거: true, 상업: true, 업무: true, 기타: true };

const DEFAULT_LAYERS: LayerState = {
  buildings: false,
  roads: true,
  basement: false,
  crowd: false,
  areas: false,
  terrain: false,
  satellite: false,
  relief: true,
  flood: false,
  water: false,
  shelter: false,
};

const LAYER_OPTIONS: { key: LayerKey; label: string; swatch: string }[] = [
  { key: 'buildings', label: '건물', swatch: '#b8bfc8' },
  { key: 'roads', label: '도로', swatch: ROAD_COLOR },
  { key: 'basement', label: '지하', swatch: BASEMENT_COLOR },
  { key: 'crowd', label: '실시간 인구', swatch: CONGESTION_COLORS['약간 붐빔'] },
  { key: 'areas', label: '권역', swatch: '#9aa7b6' },
  { key: 'terrain', label: '지형도', swatch: '#cfd8c4' },
  { key: 'satellite', label: '위성사진', swatch: '#5b7a5a' },
  { key: 'relief', label: '지형(고저)', swatch: HIGH_RELIEF_COLOR },
  { key: 'flood', label: '침수 선별', swatch: FLOOD_COLORS.primary },
  { key: 'water', label: '수위 침수', swatch: WATER_COLOR },
  { key: 'shelter', label: '대피소', swatch: '#e76f51' },
];

/** Handles the scene effect needs after it builds the scene, so toggles can update it in place. */
interface CityView {
  ground: THREE.Mesh;
  basement: THREE.Group;
  buildings: BuildingMesh[];
  roads: THREE.Mesh;
  crowd: THREE.Group;
  areas: THREE.Group;
  terrain: THREE.Group;
  satellite: THREE.Group;
  renderer: THREE.WebGLRenderer;
  relief: THREE.Mesh | null;
  buildBasement: () => void;
  buildTerrain: () => void;
  buildSatellite: () => void;
  flood: THREE.Group;
  buildFlood: () => void;
  water: THREE.Mesh;
  setWaterLevel: (level: number) => void;
  shelterGroup: THREE.Group;
  setRoute: (path: [number, number][] | null) => void;
  flyTo: (preset: ViewPreset) => void;
}

export type ViewPreset = 'default' | 'top' | 'south' | 'north' | 'east' | 'west';

const VIEW_PRESETS: { key: ViewPreset; label: string }[] = [
  { key: 'default', label: '기본' },
  { key: 'top', label: '탑뷰' },
  { key: 'south', label: '정면(남)' },
  { key: 'north', label: '배면(북)' },
  { key: 'east', label: '동측 입면' },
  { key: 'west', label: '서측 입면' },
];

/** Camera transition length in milliseconds. */
const FLY_DURATION = 600;

/**
 * Applies layer visibility. With the basement layer on, ground and buildings turn
 * translucent so underground volumes show through.
 */
function applyLayers(view: CityView, layers: LayerState, categories: CategoryState) {
  // Underground volumes are built on first use, so startup does not pay for them
  if (layers.basement) view.buildBasement();
  if (layers.terrain) view.buildTerrain();
  view.terrain.visible = layers.terrain;
  if (layers.satellite) view.buildSatellite();
  view.satellite.visible = layers.satellite;
  if (view.relief) view.relief.visible = layers.relief;
  if (layers.flood) view.buildFlood();
  view.flood.visible = layers.flood;
  view.water.visible = layers.water;
  view.shelterGroup.visible = layers.shelter;
  view.roads.visible = layers.roads;
  view.basement.visible = layers.basement;
  view.crowd.visible = layers.crowd;
  view.areas.visible = layers.areas;
  for (const mesh of view.buildings) {
    const category = mesh.userData.category as BuildingCategory;
    mesh.visible = layers.buildings && categories[category];
    setTranslucent(mesh.material, layers.basement, BUILDING_OPACITY_WITH_BASEMENT);
  }
  setTranslucent(view.ground.material as THREE.MeshStandardMaterial, layers.basement, GROUND_OPACITY_WITH_BASEMENT);
  if (view.relief) setTranslucent(view.relief.material as THREE.MeshStandardMaterial, layers.basement, GROUND_OPACITY_WITH_BASEMENT);
  // Visibility changed, so the shadows need to be drawn again
  view.renderer.shadowMap.needsUpdate = true;
}

export default function CityViewer({ buildings, roads = [], congestion = [] }: CityViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Building | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [categories, setCategories] = useState<CategoryState>(DEFAULT_CATEGORIES);
  const categoriesRef = useRef<CategoryState>(DEFAULT_CATEGORIES);
  // Read by the scene effect so a rebuild keeps the current layer state
  const layersRef = useRef<LayerState>(DEFAULT_LAYERS);
  const viewRef = useRef<CityView | null>(null);
  // Water level in meters, set from the legend slider
  const [waterLevel, setWaterLevelState] = useState(0);
  const waterLevelRef = useRef(0);
  // Shelters from public/terrain/shelters.json, as [{ name, lon, lat }]
  const [shelters, setShelters] = useState<Shelter[]>([]);
  // Route found from one building; shown only while that building is selected
  const [route, setRoute] = useState<{ building: Building; result: EvacuationRoute } | null>(null);
  const [routeMissing, setRouteMissing] = useState(false);
  useEffect(() => {
    fetch('/terrain/shelters.json')
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string; lon: number; lat: number }[]>) : []))
      .then((list) =>
        setShelters(
          list.map((shelter) => {
            const [x, z] = lonLatToMeters(shelter.lon, shelter.lat);
            return { name: shelter.name, x, z };
          }),
        ),
      )
      .catch(() => setShelters([]));
  }, []);
  // Height grid from the DEM. undefined while loading, null if the file is missing.
  const [elevation, setElevation] = useState<ElevationGrid | null | undefined>(undefined);
  useEffect(() => {
    fetch('/terrain/seoul-dem.json')
      .then((response) => (response.ok ? (response.json() as Promise<ElevationGrid>) : null))
      .then(setElevation)
      .catch(() => setElevation(null));
  }, []);
  // Screening runs once per change of the inputs, not on every render
  const floodCells = useMemo(
    () => (elevation ? floodScreening(elevation, buildings, computeBounds(buildings, roads)) : []),
    [elevation, buildings, roads],
  );
  const submergedCount = useMemo(
    () => (elevation ? submergedCells(elevation, waterLevel, computeBounds(buildings, roads)).length : 0),
    [elevation, waterLevel, buildings, roads],
  );

  useEffect(() => {
    waterLevelRef.current = waterLevel;
    viewRef.current?.setWaterLevel(waterLevel);
  }, [waterLevel]);

  // The route belongs to the selected building only
  const activeRoute = route && selected && route.building.id === selected.id ? route : null;
  useEffect(() => {
    viewRef.current?.setRoute(activeRoute?.result.path ?? null);
  }, [activeRoute]);

  const findRoute = (building: Building) => {
    const result = findEvacuationRoute([building.x, building.z], shelters, roads, elevation ?? null, waterLevel);
    setRoute(result ? { building, result } : null);
    setRouteMissing(!result);
  };
  // Compass ring, rotated every frame so N points to true north on screen
  const compassRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || elevation === undefined) return;

    const bounds = computeBounds(buildings, roads);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 100);

    // Scene, camera, renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.fog = new THREE.Fog(BACKGROUND, span * 1.5, span * 4);

    const camera = new THREE.PerspectiveCamera(45, 1, span * 0.01, span * 20);
    camera.position.set(centerX + span * 0.7, span * 0.6, centerZ + span * 0.9);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // The sun does not move, so the shadow map is redrawn only when a layer changes, not every frame
    renderer.shadowMap.autoUpdate = false;
    container.appendChild(renderer.domElement);

    // Camera controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(centerX, 0, centerZ);
    controls.maxPolarAngle = Math.PI * 0.49;
    // Keep the model in reach: no zooming into the ground or far out past the city
    controls.minDistance = span * 0.05;
    controls.maxDistance = span * 2.5;
    controls.update();

    // Reference camera poses. z grows toward the south, so "south" puts the camera at larger z.
    const poseFor = (preset: ViewPreset): { position: THREE.Vector3; target: THREE.Vector3 } => {
      const target = new THREE.Vector3(centerX, 0, centerZ);
      const d = span * 0.9;
      switch (preset) {
        case 'top':
          return { position: new THREE.Vector3(centerX, span * 1.2, centerZ + span * 0.001), target };
        case 'south':
          return { position: new THREE.Vector3(centerX, span * 0.35, centerZ + d), target };
        case 'north':
          return { position: new THREE.Vector3(centerX, span * 0.35, centerZ - d), target };
        case 'east':
          return { position: new THREE.Vector3(centerX + d, span * 0.35, centerZ), target };
        case 'west':
          return { position: new THREE.Vector3(centerX - d, span * 0.35, centerZ), target };
        default:
          return {
            position: new THREE.Vector3(centerX + span * 0.7, span * 0.6, centerZ + span * 0.9),
            target,
          };
      }
    };

    const tween = {
      active: false,
      start: 0,
      fromPos: new THREE.Vector3(),
      fromTarget: new THREE.Vector3(),
      toPos: new THREE.Vector3(),
      toTarget: new THREE.Vector3(),
    };
    const flyTo = (preset: ViewPreset) => {
      const pose = poseFor(preset);
      tween.fromPos.copy(camera.position);
      tween.fromTarget.copy(controls.target);
      tween.toPos.copy(pose.position);
      tween.toTarget.copy(pose.target);
      tween.start = performance.now();
      tween.active = true;
    };

    // Lighting
    scene.add(new THREE.HemisphereLight('#ffffff', '#9aa5b1', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(centerX + span * 0.4, span, centerZ + span * 0.3);
    sun.target.position.set(centerX, 0, centerZ);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadowHalf = span * 0.6;
    Object.assign(sun.shadow.camera, {
      left: -shadowHalf,
      right: shadowHalf,
      top: shadowHalf,
      bottom: -shadowHalf,
      far: span * 3,
    });
    scene.add(sun, sun.target);

    // Ground and grid
    const groundSize = span * 1.6;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, -0.01, centerZ);
    ground.receiveShadow = true;
    scene.add(ground);

    // Real ground heights, drawn over the flat plane. The plane stays underneath as the far field.
    let relief: THREE.Mesh | null = null;
    if (elevation) {
      relief = new THREE.Mesh(
        reliefGeometry(elevation),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      );
      relief.receiveShadow = true;
      scene.add(relief);
    }

    const grid = new THREE.GridHelper(groundSize, 40, '#b7c0cb', '#cfd6df');
    grid.position.set(centerX, 0, centerZ);
    scene.add(grid);

    // Roads: one merged mesh for all centerlines
    const roadGeometry = buildRoadGeometry(roads, elevation ?? null);
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: ROAD_COLOR,
      roughness: 1,
      side: THREE.DoubleSide,
      // Pull roads slightly toward the camera so they win against the ground where they touch
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // Real-time crowd level per area, drawn as translucent discs on the ground
    const crowd = new THREE.Group();
    scene.add(crowd);
    const crowdGeometry = new THREE.CircleGeometry(CROWD_RADIUS, 48);
    crowdGeometry.rotateX(-Math.PI / 2);
    const crowdMaterials: THREE.MeshBasicMaterial[] = [];
    for (const area of congestion) {
      const material = new THREE.MeshBasicMaterial({
        color: congestionColor(area.level),
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      crowdMaterials.push(material);
      const disc = new THREE.Mesh(crowdGeometry, material);
      disc.position.set(area.x, elevationAt(elevation, area.x, area.z) + 0.06, area.z);
      crowd.add(disc);
    }

    // Areas (권역): each area's nearest-center region as a tinted cell with an outline
    const areas = new THREE.Group();
    scene.add(areas);
    const areaGeometries: THREE.BufferGeometry[] = [];
    const areaMaterials: THREE.Material[] = [];
    // Cover the buildings and every area center, so no center falls outside the split
    const areaRect = congestion.reduce(
      (rect, area) => ({
        minX: Math.min(rect.minX, area.x),
        maxX: Math.max(rect.maxX, area.x),
        minZ: Math.min(rect.minZ, area.z),
        maxZ: Math.max(rect.maxZ, area.z),
      }),
      bounds,
    );
    for (const region of areaRegions(congestion, areaRect)) {
      if (region.points.length < 3) continue;
      // Regions are convex, so a fan from the first corner covers each one
      const positions: number[] = [];
      for (let i = 1; i < region.points.length - 1; i++) {
        positions.push(...drapeTriangle(region.points[0], region.points[i], region.points[i + 1], elevation ?? null));
      }
      const fill = new THREE.BufferGeometry();
      fill.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: region.color,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      areaGeometries.push(fill);
      areaMaterials.push(fillMaterial);
      areas.add(new THREE.Mesh(fill, fillMaterial));

      const outline = new THREE.BufferGeometry().setFromPoints(
        region.points.map(([x, z]) => new THREE.Vector3(x, elevationAt(elevation, x, z) + AREA_Y + 0.01, z)),
      );
      const outlineMaterial = new THREE.LineBasicMaterial({ color: region.color });
      areaGeometries.push(outline);
      areaMaterials.push(outlineMaterial);
      areas.add(new THREE.LineLoop(outline, outlineMaterial));
    }

    // Buildings: one mesh per building, geometry already in world meters
    const city = new THREE.Group();
    scene.add(city);

    const meshes: BuildingMesh[] = [];
    // Underground-only facilities are drawn in the basement layer, not above ground
    for (const b of buildings) {
      if (b.underground) continue;
      const material = new THREE.MeshStandardMaterial({ color: categoryColor(b), roughness: 0.7, metalness: 0.05 });
      const mesh: BuildingMesh = new THREE.Mesh(createPrism(b, b.height), material);
      mesh.position.set(b.x, elevationAt(elevation, b.x, b.z), b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.building = b;
      mesh.userData.category = categorize(b);
      city.add(mesh);
      meshes.push(mesh);
    }

    // Underground volumes sit below ground. They are built the first time the layer turns on.
    const basement = new THREE.Group();
    scene.add(basement);
    const basementMaterial = new THREE.MeshStandardMaterial({
      color: BASEMENT_COLOR,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const basementGeometries: THREE.BufferGeometry[] = [];
    let basementBuilt = false;
    const buildBasement = () => {
      if (basementBuilt) return;
      basementBuilt = true;
      for (const b of buildings) {
        if (!b.basementDepth) continue;
        const geometry = createPrism(b, b.basementDepth);
        geometry.translate(0, -b.basementDepth, 0);
        basementGeometries.push(geometry);
        // Footprints are built around the origin, so move each volume to its building
        const mesh = new THREE.Mesh(geometry, basementMaterial);
        mesh.position.set(b.x, elevationAt(elevation, b.x, b.z), b.z);
        basement.add(mesh);
      }
    };
    // Map image layers (지형도, 위성사진): VWorld tiles draped on the ground. Each layer loads
    // the first time its toggle turns on.
    const imageryGeometries: THREE.BufferGeometry[] = [];
    const imageryMaterials: THREE.MeshBasicMaterial[] = [];
    const imageryTextures: THREE.Texture[] = [];
    const builtLayers = new Set<TileLayer>();
    const buildImagery = (layer: TileLayer, group: THREE.Group, lift: number) => {
      if (builtLayers.has(layer)) return;
      builtLayers.add(layer);
      const loader = new THREE.TextureLoader();
      for (const tile of tilesCovering(bounds)) {
        const geometry = tileGeometry(tile, elevation ?? null, lift);
        const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        loader.load(
          `/api/vworld-tile/${tile.z}/${tile.y}/${tile.x}?layer=${layer}`,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            material.map = texture;
            material.needsUpdate = true;
            imageryTextures.push(texture);
          },
          undefined,
          () => console.warn(`[${layer}] tile ${tile.z}/${tile.y}/${tile.x} failed`),
        );
        imageryGeometries.push(geometry);
        imageryMaterials.push(material);
        group.add(new THREE.Mesh(geometry, material));
      }
    };
    const terrain = new THREE.Group();
    scene.add(terrain);
    const satellite = new THREE.Group();
    scene.add(satellite);
    const buildTerrain = () => buildImagery('Base', terrain, TERRAIN_Y);
    const buildSatellite = () => buildImagery('Satellite', satellite, IMAGERY_Y);

    // Flood screening tint over the DEM cells picked by floodScreening. Built on first use.
    const flood = new THREE.Group();
    scene.add(flood);
    const floodParts: { geometry?: THREE.BufferGeometry; material?: THREE.MeshBasicMaterial } = {};
    let floodBuilt = false;
    const buildFlood = () => {
      if (floodBuilt || !elevation) return;
      floodBuilt = true;
      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const color = new THREE.Color();
      const halfX = elevation.stepX / 2;
      const halfZ = elevation.stepZ / 2;
      for (const cell of floodCells) {
        const cx = elevation.originX + cell.col * elevation.stepX;
        const cz = elevation.originZ + cell.row * elevation.stepZ;
        const base = positions.length / 3;
        // Corners in order NW, NE, SW, SE, each following the ground height
        for (const [x, z] of [
          [cx - halfX, cz - halfZ],
          [cx + halfX, cz - halfZ],
          [cx - halfX, cz + halfZ],
          [cx + halfX, cz + halfZ],
        ]) {
          positions.push(x, elevationAt(elevation, x, z) + FLOOD_Y, z);
          color.set(FLOOD_COLORS[cell.cls]);
          colors.push(color.r, color.g, color.b);
        }
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      floodParts.geometry = geometry;
      floodParts.material = material;
      flood.add(new THREE.Mesh(geometry, material));
    };

    // Shelter markers and the evacuation route line. Both are replaced when their data changes.
    const shelterGroup = new THREE.Group();
    scene.add(shelterGroup);
    const markerGeometry = new THREE.CylinderGeometry(6, 6, 18, 12);
    const markerMaterial = new THREE.MeshStandardMaterial({ color: '#e76f51', roughness: 0.6 });
    for (const shelter of shelters) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(shelter.x, elevationAt(elevation, shelter.x, shelter.z) + 9, shelter.z);
      marker.castShadow = true;
      shelterGroup.add(marker);
    }

    const routeGroup = new THREE.Group();
    scene.add(routeGroup);
    let routeGeometry: THREE.BufferGeometry | null = null;
    const routeMaterial = new THREE.LineBasicMaterial({ color: '#ff7a3d', depthTest: false });
    const setRoute = (path: [number, number][] | null) => {
      routeGroup.clear();
      routeGeometry?.dispose();
      routeGeometry = null;
      if (!path || path.length < 2) return;
      routeGeometry = new THREE.BufferGeometry().setFromPoints(
        path.map(([x, z]) => new THREE.Vector3(x, elevationAt(elevation, x, z) + 1.5, z)),
      );
      const line = new THREE.Line(routeGeometry, routeMaterial);
      line.renderOrder = 10;
      routeGroup.add(line);
    };

    // Water surface at the chosen level. Its geometry is rebuilt whenever the level changes.
    const water = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: WATER_COLOR,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    scene.add(water);
    const setWaterLevel = (level: number) => {
      const positions: number[] = [];
      const indices: number[] = [];
      if (elevation) {
        const y = level + WATER_Y;
        for (const index of submergedCells(elevation, level, bounds)) {
          const row = Math.floor(index / elevation.ncols);
          const col = index % elevation.ncols;
          const x0 = elevation.originX + (col - 0.5) * elevation.stepX;
          const x1 = elevation.originX + (col + 0.5) * elevation.stepX;
          const z0 = elevation.originZ + (row - 0.5) * elevation.stepZ;
          const z1 = elevation.originZ + (row + 0.5) * elevation.stepZ;
          const base = positions.length / 3;
          positions.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
          indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      }
      water.geometry.dispose();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      water.geometry = geometry;
    };
    setWaterLevel(waterLevelRef.current);

    viewRef.current = {
      renderer,
      water,
      setWaterLevel,
      shelterGroup,
      setRoute,
      ground,
      relief,
      basement,
      buildings: meshes,
      roads: roadMesh,
      crowd,
      areas,
      terrain,
      satellite,
      flood,
      buildBasement,
      buildTerrain,
      buildSatellite,
      buildFlood,
      flyTo,
    };
    applyLayers(viewRef.current, layersRef.current, categoriesRef.current);

    // Hover and selection highlighting
    let hovered: BuildingMesh | null = null;
    let picked: BuildingMesh | null = null;

    const refresh = (mesh: BuildingMesh) => {
      const material = mesh.material;
      if (mesh === picked) {
        material.emissive.set(SELECTED_EMISSIVE);
        material.emissiveIntensity = 0.45;
      } else if (mesh === hovered) {
        material.emissive.set(HOVER_EMISSIVE);
        material.emissiveIntensity = 0.3;
      } else {
        material.emissiveIntensity = 0;
      }
    };

    // Picking
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes.filter((mesh) => mesh.visible), false)[0];
      return hit ? (hit.object as BuildingMesh) : null;
    };

    let pressX = 0;
    let pressY = 0;
    const canvas = renderer.domElement;

    const onPointerDown = (event: PointerEvent) => {
      pressX = event.clientX;
      pressY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      const next = pick(event);
      if (next === hovered) return;
      const previous = hovered;
      hovered = next;
      if (previous) refresh(previous);
      if (next) refresh(next);
      canvas.style.cursor = next ? 'pointer' : 'grab';
    };

    const onPointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > CLICK_TOLERANCE) return;
      const hit = pick(event);
      const previous = picked;
      picked = hit;
      if (previous) refresh(previous);
      if (hit) refresh(hit);
      setSelected(hit ? (hit.userData.building as Building) : null);
    };

    const onPointerLeave = () => {
      const previous = hovered;
      hovered = null;
      if (previous) refresh(previous);
      canvas.style.cursor = 'grab';
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.style.cursor = 'grab';

    // Responsive sizing
    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    // Render loop
    renderer.setAnimationLoop(() => {
      if (tween.active) {
        const t = Math.min((performance.now() - tween.start) / FLY_DURATION, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(tween.fromPos, tween.toPos, eased);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        if (t >= 1) tween.active = false;
      }
      controls.update();
      // World north is -z. Express it in camera space to get its on-screen direction,
      // then turn the compass ring by that angle (clockwise from screen up).
      const north = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion.clone().invert());
      if (compassRef.current) {
        const degrees = (Math.atan2(north.x, north.y) * 180) / Math.PI;
        // Only the ring turns; each letter counter-rotates in CSS so it stays upright
        compassRef.current.style.setProperty('--angle', `${degrees}deg`);
      }
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      controls.dispose();

      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      if (relief) {
        relief.geometry.dispose();
        (relief.material as THREE.Material).dispose();
      }
      grid.dispose();
      roadGeometry.dispose();
      roadMaterial.dispose();
      crowdGeometry.dispose();
      for (const material of crowdMaterials) material.dispose();
      for (const geometry of areaGeometries) geometry.dispose();
      for (const material of areaMaterials) material.dispose();
      for (const geometry of imageryGeometries) geometry.dispose();
      for (const material of imageryMaterials) material.dispose();
      for (const texture of imageryTextures) texture.dispose();
      floodParts.geometry?.dispose();
      floodParts.material?.dispose();
      water.geometry.dispose();
      (water.material as THREE.Material).dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      routeGeometry?.dispose();
      routeMaterial.dispose();
      for (const geometry of basementGeometries) geometry.dispose();
      basementMaterial.dispose();
      viewRef.current = null;
      sun.shadow.map?.dispose();

      renderer.dispose();
      canvas.remove();
    };
  }, [buildings, roads, congestion, elevation, floodCells, shelters]);

  useEffect(() => {
    categoriesRef.current = categories;
    if (viewRef.current) applyLayers(viewRef.current, layersRef.current, categories);
  }, [categories]);

  useEffect(() => {
    layersRef.current = layers;
    if (viewRef.current) applyLayers(viewRef.current, layers, categoriesRef.current);
  }, [layers]);

  const aboveGround = buildings.filter((b) => !b.underground);
  const counts: Record<LayerKey, number> = {
    buildings: aboveGround.length,
    roads: roads.length,
    basement: buildings.filter((b) => b.basementDepth).length,
    crowd: congestion.length,
    areas: congestion.length,
    terrain: tilesCovering(computeBounds(buildings, roads)).length,
    satellite: tilesCovering(computeBounds(buildings, roads)).length,
    relief: elevation ? elevation.heights.length : 0,
    flood: floodCells.length,
    water: submergedCount,
    shelter: shelters.length,
  };
  const categoryCounts = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<BuildingCategory, number>;
  for (const b of aboveGround) categoryCounts[categorize(b)]++;

  const toggleCategory = (category: BuildingCategory) =>
    setCategories((prev) => ({ ...prev, [category]: !prev[category] }));

  return (
    <div className="viewer">
      <div ref={containerRef} className="viewer-canvas" />
      <div className="view-presets" role="group" aria-label="시점">
        {VIEW_PRESETS.map((preset) => (
          <button key={preset.key} type="button" onClick={() => viewRef.current?.flyTo(preset.key)}>
            {preset.label}
          </button>
        ))}
      </div>
      <div className="compass" aria-hidden="true">
        <div className="compass-ring" ref={compassRef}>
          <span className="compass-n">N</span>
          <span className="compass-e">E</span>
          <span className="compass-s">S</span>
          <span className="compass-w">W</span>
        </div>
      </div>
      <div className="legend" role="group" aria-label="레이어">
        <div className="legend-title">레이어</div>
        {LAYER_OPTIONS.map((option) => (
          <div key={option.key}>
            <label className="legend-item">
              <input
                type="checkbox"
                checked={layers[option.key]}
                onChange={() => setLayers((prev) => ({ ...prev, [option.key]: !prev[option.key] }))}
              />
              <span className="swatch" style={{ background: option.swatch }} aria-hidden="true" />
              <span className="label">{option.label}</span>
              <span className="count">{counts[option.key].toLocaleString()}</span>
            </label>
            {option.key === 'buildings' &&
              CATEGORY_ORDER.map((category) => (
                <label key={category} className="legend-item legend-sub">
                  <input
                    type="checkbox"
                    checked={categories[category]}
                    disabled={!layers.buildings}
                    onChange={() => toggleCategory(category)}
                  />
                  <span className="swatch" style={{ background: CATEGORY_SWATCH[category] }} aria-hidden="true" />
                  <span className="label">{category}</span>
                  <span className="count">{categoryCounts[category].toLocaleString()}</span>
                </label>
              ))}
            {option.key === 'water' && layers.water && (
              <div className="legend-item legend-sub legend-level">
                <span aria-hidden="true" />
                <input
                  type="range"
                  min={0}
                  max={WATER_MAX}
                  step={WATER_STEP}
                  value={waterLevel}
                  onChange={(event) => setWaterLevelState(Number(event.target.value))}
                  aria-label="수위 (m)"
                  style={{ gridColumn: 'span 2', width: '100%' }}
                />
                <span className="count">{waterLevel.toFixed(1)} m</span>
              </div>
            )}
            {option.key === 'flood' &&
              layers.flood &&
              FLOOD_CLASSES.map((cls) => (
                <div key={cls} className="legend-item legend-sub legend-level">
                  <span aria-hidden="true" />
                  <span className="swatch" style={{ background: FLOOD_COLORS[cls] }} aria-hidden="true" />
                  <span className="label">{FLOOD_LABELS[cls]}</span>
                  <span className="count">{floodCells.filter((cell) => cell.cls === cls).length.toLocaleString()}</span>
                </div>
              ))}
            {option.key === 'areas' &&
              layers.areas &&
              congestion.map((area, i) => (
                <div key={area.name} className="legend-item legend-sub legend-level">
                  <span aria-hidden="true" />
                  <span className="swatch" style={{ background: areaColor(i) }} aria-hidden="true" />
                  <span className="label">{area.name}</span>
                  <span className="count">{area.level || '-'}</span>
                </div>
              ))}
            {option.key === 'crowd' &&
              layers.crowd &&
              CONGESTION_LEVELS.map((level) => (
                <div key={level} className="legend-item legend-sub legend-level">
                  <span aria-hidden="true" />
                  <span className="swatch" style={{ background: congestionColor(level) }} aria-hidden="true" />
                  <span className="label">{level}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
      {selected && (
        <aside className="info-panel" aria-live="polite">
          <header>
            <h2>{selected.name}</h2>
            <button type="button" onClick={() => setSelected(null)} aria-label="Close details">
              ×
            </button>
          </header>
          <dl>
            <dt>Usage</dt>
            <dd>{selected.usage}</dd>
            <dt>Height</dt>
            <dd>{selected.height.toFixed(1)} m</dd>
            <dt>Footprint</dt>
            <dd>
              {selected.width.toFixed(1)} × {selected.depth.toFixed(1)} m
            </dd>
            <dt>Position</dt>
            <dd>
              x {selected.x.toFixed(1)}, z {selected.z.toFixed(1)}
            </dd>
          </dl>
          <div className="route">
            <button type="button" className="route-button" onClick={() => findRoute(selected)}>
              대피 경로 찾기 (수위 {waterLevel.toFixed(1)} m)
            </button>
            {shelters.length === 0 && <p className="route-note">대피소 데이터가 없습니다. public/terrain/shelters.json을 확인하세요.</p>}
            {shelters.length > 0 && routeMissing && route === null && (
              <p className="route-note">도달 가능한 대피소를 찾지 못했습니다. 물에 잠기지 않은 도로가 끊겨 있을 수 있습니다.</p>
            )}
            {activeRoute && (
              <p className="route-note">
                {activeRoute.result.shelter.name} · 약 {Math.round(activeRoute.result.length).toLocaleString()} m
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
