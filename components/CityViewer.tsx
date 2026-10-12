'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Building } from '@/lib/types';

interface CityViewerProps {
  buildings: Building[];
}

const BACKGROUND = '#e9edf2';
const HOVER_EMISSIVE = '#4cc9f0';
const SELECTED_EMISSIVE = '#ff7a3d';
/** Pointer travel (px) above which a press is treated as a camera drag, not a click. */
const CLICK_TOLERANCE = 4;

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type BuildingMesh = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;

function computeBounds(buildings: Building[]): Bounds {
  if (buildings.length === 0) {
    return { minX: -250, maxX: 250, minZ: -250, maxZ: 250 };
  }
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const b of buildings) {
    bounds.minX = Math.min(bounds.minX, b.x - b.width / 2);
    bounds.maxX = Math.max(bounds.maxX, b.x + b.width / 2);
    bounds.minZ = Math.min(bounds.minZ, b.z - b.depth / 2);
    bounds.maxZ = Math.max(bounds.maxZ, b.z + b.depth / 2);
  }
  return bounds;
}

export default function CityViewer({ buildings }: CityViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Building | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const bounds = computeBounds(buildings);
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
    controls.update();

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

    // Buildings: one unit box (base at y = 0), scaled per building
    const city = new THREE.Group();
    scene.add(city);
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitBox.translate(0, 0.5, 0);

    const meshes: BuildingMesh[] = [];
    for (const b of buildings) {
      const material = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.7, metalness: 0.05 });
      const mesh: BuildingMesh = new THREE.Mesh(unitBox, material);
      mesh.scale.set(b.width, b.height, b.depth);
      mesh.position.set(b.x, 0, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.building = b;
      city.add(mesh);
      meshes.push(mesh);
    }

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
      const hit = raycaster.intersectObjects(meshes, false)[0];
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

      for (const mesh of meshes) mesh.material.dispose();
      unitBox.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.dispose();
      sun.shadow.map?.dispose();

      renderer.dispose();
      canvas.remove();
    };
  }, [buildings]);

  return (
    <div className="viewer">
      <div ref={containerRef} className="viewer-canvas" />
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
