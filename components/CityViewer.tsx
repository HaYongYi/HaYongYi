'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Building, Road } from '@/lib/types';
import { CATEGORY_ORDER, CATEGORY_SWATCH, categorize, categoryColor, type BuildingCategory } from '@/lib/building-category';

interface CityViewerProps {
  buildings: Building[];
  roads?: Road[];
}

/** Road surface sits just above the ground plane so it is not hidden by z-fighting. */
const ROAD_Y = 0.03;
const DEFAULT_ROAD_WIDTH = 8;
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
function buildRoadGeometry(roads: Road[]): THREE.BufferGeometry {
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
      const base = positions.length / 3;
      positions.push(
        x0 + nx, ROAD_Y, z0 + nz,
        x0 - nx, ROAD_Y, z0 - nz,
        x1 + nx, ROAD_Y, z1 + nz,
        x1 - nx, ROAD_Y, z1 - nz,
      );
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type LayerKey = 'buildings' | 'roads' | 'basement';
type LayerState = Record<LayerKey, boolean>;
type CategoryState = Record<BuildingCategory, boolean>;

const DEFAULT_CATEGORIES: CategoryState = { 교통: true, 주거: true, 상업: true, 업무: true, 기타: true };

const DEFAULT_LAYERS: LayerState = { buildings: true, roads: true, basement: false };

const LAYER_OPTIONS: { key: LayerKey; label: string; swatch: string }[] = [
  { key: 'buildings', label: '건물', swatch: '#b8bfc8' },
  { key: 'roads', label: '도로', swatch: ROAD_COLOR },
  { key: 'basement', label: '지하', swatch: BASEMENT_COLOR },
];

/** Handles the scene effect needs after it builds the scene, so toggles can update it in place. */
interface CityView {
  ground: THREE.Mesh;
  basement: THREE.Group;
  buildings: BuildingMesh[];
  roads: THREE.Mesh;
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
  view.roads.visible = layers.roads;
  view.basement.visible = layers.basement;
  for (const mesh of view.buildings) {
    const category = mesh.userData.category as BuildingCategory;
    mesh.visible = layers.buildings && categories[category];
    setTranslucent(mesh.material, layers.basement, BUILDING_OPACITY_WITH_BASEMENT);
  }
  setTranslucent(view.ground.material as THREE.MeshStandardMaterial, layers.basement, GROUND_OPACITY_WITH_BASEMENT);
}

export default function CityViewer({ buildings, roads = [] }: CityViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Building | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [categories, setCategories] = useState<CategoryState>(DEFAULT_CATEGORIES);
  const categoriesRef = useRef<CategoryState>(DEFAULT_CATEGORIES);
  // Read by the scene effect so a rebuild keeps the current layer state
  const layersRef = useRef<LayerState>(DEFAULT_LAYERS);
  const viewRef = useRef<CityView | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    const grid = new THREE.GridHelper(groundSize, 40, '#b7c0cb', '#cfd6df');
    grid.position.set(centerX, 0, centerZ);
    scene.add(grid);

    // Roads: one merged mesh for all centerlines
    const roadGeometry = buildRoadGeometry(roads);
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: ROAD_COLOR,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // Buildings: one mesh per building, geometry already in world meters
    const city = new THREE.Group();
    scene.add(city);

    const meshes: BuildingMesh[] = [];
    // Underground-only facilities are drawn in the basement layer, not above ground
    for (const b of buildings) {
      if (b.underground) continue;
      const material = new THREE.MeshStandardMaterial({ color: categoryColor(b), roughness: 0.7, metalness: 0.05 });
      const mesh: BuildingMesh = new THREE.Mesh(createPrism(b, b.height), material);
      mesh.position.set(b.x, 0, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.building = b;
      mesh.userData.category = categorize(b);
      city.add(mesh);
      meshes.push(mesh);
    }

    // Underground volumes sit below ground; hidden until the toggle is on
    const basement = new THREE.Group();
    scene.add(basement);
    const basementMaterial = new THREE.MeshStandardMaterial({
      color: BASEMENT_COLOR,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const basementGeometries: THREE.BufferGeometry[] = [];
    for (const b of buildings) {
      if (!b.basementDepth) continue;
      const geometry = createPrism(b, b.basementDepth);
      geometry.translate(0, -b.basementDepth, 0);
      basementGeometries.push(geometry);
      basement.add(new THREE.Mesh(geometry, basementMaterial));
    }
    viewRef.current = { ground, basement, buildings: meshes, roads: roadMesh, flyTo };
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
      grid.dispose();
      roadGeometry.dispose();
      roadMaterial.dispose();
      for (const geometry of basementGeometries) geometry.dispose();
      basementMaterial.dispose();
      viewRef.current = null;
      sun.shadow.map?.dispose();

      renderer.dispose();
      canvas.remove();
    };
  }, [buildings, roads]);

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
        </aside>
      )}
    </div>
  );
}
