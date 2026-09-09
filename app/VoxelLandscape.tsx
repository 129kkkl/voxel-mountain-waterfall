"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type SceneMetrics = {
  fps: number;
  terrainVoxels: number;
  waterVoxels: number;
  cloudVoxels: number;
  vegetationVoxels: number;
  totalVoxels: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  quality: "high" | "adaptive";
};

declare global {
  interface Window {
    __VOXEL_SCENE_METRICS__?: SceneMetrics;
  }
}

type VoxelLandscapeProps = {
  touring: boolean;
  onReady: (metrics: SceneMetrics) => void;
  onMetrics: (metrics: SceneMetrics) => void;
  onError: (message: string) => void;
};

type HeightGrid = {
  heights: number[][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  get: (x: number, z: number) => number;
};

type BoxInstance = {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  color?: THREE.Color;
};

type DropSpan = {
  x: number;
  z: number;
  top: number;
  bottom: number;
  width: number;
};

type FlowParticle = DropSpan & {
  phase: number;
  speed: number;
  lateral: number;
};

const MIN_X = -38;
const MAX_X = 38;
const MIN_Z = -31;
const MAX_Z = 35;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const fract = (value: number) => value - Math.floor(value);

const hash2 = (x: number, z: number) =>
  fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);

const smoothstep = (value: number) => value * value * (3 - 2 * value);

function valueNoise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fz = smoothstep(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const ab = THREE.MathUtils.lerp(a, b, fx);
  const cd = THREE.MathUtils.lerp(c, d, fx);
  return THREE.MathUtils.lerp(ab, cd, fz);
}

function fbm(x: number, z: number) {
  let amplitude = 0.55;
  let frequency = 0.09;
  let sum = 0;
  let normalizer = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += valueNoise(x * frequency, z * frequency) * amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2.05;
  }
  return sum / normalizer;
}

function gaussian(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
) {
  const dx = (x - centerX) / radiusX;
  const dz = (z - centerZ) / radiusZ;
  return Math.exp(-(dx * dx + dz * dz));
}

function islandMask(x: number, z: number) {
  const distance = Math.hypot(x / 42, z / 38);
  return clamp(1 - Math.pow(distance, 1.7), 0, 1);
}

function rawMountainHeight(x: number, z: number) {
  const mask = islandMask(x, z);
  if (mask <= 0) return 0;

  const mainPeak = 29 * gaussian(x, z, -8, -5, 12.5, 11);
  const eastPeak = 21 * gaussian(x, z, 15, -8, 10.5, 9.5);
  const westPeak = 16 * gaussian(x, z, -24, 7, 9.5, 12.5);
  const rearPeak = 14 * gaussian(x, z, 6, 14, 13, 10);
  const connectingRidge =
    7.5 *
    gaussian(x, z, 0, 1, 25, 9) *
    (0.72 + Math.abs(Math.sin(x * 0.13)) * 0.28);
  const valley = 4.2 * gaussian(x, z, 3, 3, 6.5, 17);
  const broadNoise = (fbm(x + 18, z - 7) - 0.5) * 5.5;
  const ridgeNoise = Math.abs(valueNoise(x * 0.17 + 9, z * 0.17 - 3) - 0.5) * 2.8;
  const base = 2.4 + mainPeak + eastPeak + westPeak + rearPeak + connectingRidge;
  const shaped = (base + broadNoise + ridgeNoise - valley) * (0.22 + mask * 0.78);
  return clamp(Math.floor(shaped * Math.min(1, mask * 4.5)), 0, 36);
}

function carveChannel(
  grid: HeightGrid,
  zStart: number,
  zEnd: number,
  path: (z: number) => number,
  forcedDrops: Map<number, number>,
) {
  let channelHeight = grid.get(path(zStart), zStart);
  for (let z = zStart; z <= zEnd; z += 1) {
    const centerX = Math.round(path(z));
    channelHeight = Math.min(channelHeight, grid.get(centerX, z));
    channelHeight = Math.max(1, channelHeight - (forcedDrops.get(z) ?? 0));

    for (let offset = -1; offset <= 1; offset += 1) {
      const x = centerX + offset;
      const ix = x - grid.minX;
      const iz = z - grid.minZ;
      if (ix < 0 || iz < 0 || ix >= grid.heights.length || iz >= grid.heights[0].length) {
        continue;
      }
      const bankLift = Math.abs(offset);
      grid.heights[ix][iz] = Math.min(grid.heights[ix][iz], channelHeight + bankLift);
    }
  }
}

function createHeightGrid(): HeightGrid {
  const heights = Array.from({ length: MAX_X - MIN_X + 1 }, (_, ix) =>
    Array.from({ length: MAX_Z - MIN_Z + 1 }, (_, iz) =>
      rawMountainHeight(ix + MIN_X, iz + MIN_Z),
    ),
  );

  const grid: HeightGrid = {
    heights,
    minX: MIN_X,
    maxX: MAX_X,
    minZ: MIN_Z,
    maxZ: MAX_Z,
    get(x, z) {
      const ix = Math.round(x) - MIN_X;
      const iz = Math.round(z) - MIN_Z;
      if (ix < 0 || iz < 0 || ix >= heights.length || iz >= heights[0].length) return 0;
      return heights[ix][iz];
    },
  };

  carveChannel(
    grid,
    -6,
    28,
    (z) => -8 + Math.sin((z + 5) * 0.22) * 1.35,
    new Map([
      [3, 5],
      [12, 4],
      [20, 2],
    ]),
  );
  carveChannel(
    grid,
    -9,
    23,
    (z) => 15 + Math.sin((z + 8) * 0.2 + 1.2) * 0.9,
    new Map([
      [1, 4],
      [11, 3],
    ]),
  );

  return grid;
}

function getSlope(grid: HeightGrid, x: number, z: number) {
  const height = grid.get(x, z);
  return Math.max(
    Math.abs(height - grid.get(x + 1, z)),
    Math.abs(height - grid.get(x - 1, z)),
    Math.abs(height - grid.get(x, z + 1)),
    Math.abs(height - grid.get(x, z - 1)),
  );
}

function terrainColor(x: number, y: number, z: number, top: number, slope: number) {
  const variation = (hash2(x * 1.31 + y, z * 0.87 - y) - 0.5) * 0.1;
  const color = new THREE.Color();
  const isTop = y === top;

  if (isTop && top >= 26) color.set(0xd8d8c8);
  else if (isTop && top >= 20) color.set(slope >= 3 ? 0x70776d : 0x899084);
  else if (isTop && slope <= 2) color.set(top <= 7 ? 0x4f6d52 : 0x58705b);
  else if (y <= Math.max(2, top - 4) && top < 12) color.set(0x5b5142);
  else color.set(y > 15 ? 0x687069 : 0x58615c);

  color.offsetHSL(variation * 0.08, variation * 0.18, variation);
  return color;
}

function createPixelTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(32, 32);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const index = (y * 32 + x) * 4;
      const grain = 218 + Math.floor(hash2(x + 23, y - 17) * 34);
      image.data[index] = grain;
      image.data[index + 1] = grain;
      image.data[index + 2] = grain;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.anisotropy = 2;
  return texture;
}

function createRadialTexture(inner: string, outer: string, size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.28, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addFaceShading(geometry: THREE.BoxGeometry) {
  const normals = geometry.getAttribute("normal");
  const colors = new Float32Array(normals.count * 3);
  for (let index = 0; index < normals.count; index += 1) {
    const nx = normals.getX(index);
    const ny = normals.getY(index);
    const nz = normals.getZ(index);
    const shade = ny > 0.5 ? 1 : ny < -0.5 ? 0.62 : nx > 0.5 ? 0.84 : nz > 0.5 ? 0.91 : 0.76;
    colors[index * 3] = shade;
    colors[index * 3 + 1] = shade;
    colors[index * 3 + 2] = shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function buildInstancedBoxes(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: BoxInstance[],
) {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  const object = new THREE.Object3D();
  instances.forEach((instance, index) => {
    object.position.copy(instance.position);
    object.scale.copy(instance.scale);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
    if (instance.color) mesh.setColorAt(index, instance.color);
  });
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function buildTerrain(grid: HeightGrid, texture: THREE.Texture | null) {
  const instances: BoxInstance[] = [];
  for (let x = grid.minX; x <= grid.maxX; x += 1) {
    for (let z = grid.minZ; z <= grid.maxZ; z += 1) {
      const height = grid.get(x, z);
      const mask = islandMask(x, z);
      if (mask > 0.045) {
        const baseColor = new THREE.Color(height > 0 ? 0x3e5245 : 0x42564a);
        baseColor.offsetHSL(0, 0, (hash2(x - 40, z + 15) - 0.5) * 0.06);
        instances.push({
          position: new THREE.Vector3(x, 0, z),
          scale: new THREE.Vector3(1, 1, 1),
          color: baseColor,
        });
      }
      if (height <= 0) continue;

      const neighbors = [
        grid.get(x + 1, z),
        grid.get(x - 1, z),
        grid.get(x, z + 1),
        grid.get(x, z - 1),
      ];
      const lowestNeighbor = Math.min(...neighbors);
      const startY = Math.max(1, lowestNeighbor + 1);
      const slope = getSlope(grid, x, z);
      for (let y = startY; y <= height; y += 1) {
        instances.push({
          position: new THREE.Vector3(x, y, z),
          scale: new THREE.Vector3(1, 1, 1),
          color: terrainColor(x, y, z, height, slope),
        });
      }
    }
  }

  const geometry = new THREE.BoxGeometry(0.965, 0.965, 0.965);
  addFaceShading(geometry);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.98,
    metalness: 0,
    vertexColors: true,
  });
  const mesh = buildInstancedBoxes(geometry, material, instances);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "voxel-terrain";
  return { mesh, count: instances.length };
}

function nearWaterCourse(x: number, z: number) {
  const mainX = -8 + Math.sin((z + 5) * 0.22) * 1.35;
  const eastX = 15 + Math.sin((z + 8) * 0.2 + 1.2) * 0.9;
  return (
    (z >= -7 && z <= 30 && Math.abs(x - mainX) < 3.4) ||
    (z >= -10 && z <= 25 && Math.abs(x - eastX) < 2.6)
  );
}

function buildVegetation(grid: HeightGrid) {
  const trunks: BoxInstance[] = [];
  const leaves: BoxInstance[] = [];
  const shrubs: BoxInstance[] = [];
  let treeCount = 0;

  for (let x = grid.minX + 2; x <= grid.maxX - 2; x += 1) {
    for (let z = grid.minZ + 2; z <= grid.maxZ - 2; z += 1) {
      const height = grid.get(x, z);
      const slope = getSlope(grid, x, z);
      const chance = hash2(x * 1.73 + 99, z * 1.41 - 23);
      if (
        treeCount < 118 &&
        height >= 1 &&
        height <= 10 &&
        slope <= 2 &&
        chance > 0.965 &&
        !nearWaterCourse(x, z)
      ) {
        const treeScale = 0.78 + hash2(x - 12, z + 41) * 0.42;
        const trunkHeight = 1.25 * treeScale;
        trunks.push({
          position: new THREE.Vector3(x, height + trunkHeight * 0.5 + 0.48, z),
          scale: new THREE.Vector3(0.32, trunkHeight, 0.32),
          color: new THREE.Color(0x594b38),
        });
        const leafColor = new THREE.Color(height > 7 ? 0x405b4d : 0x365849);
        leafColor.offsetHSL((chance - 0.965) * 0.4, 0, (hash2(x, z) - 0.5) * 0.07);
        const crownBase = height + trunkHeight + 0.42;
        leaves.push(
          {
            position: new THREE.Vector3(x, crownBase, z),
            scale: new THREE.Vector3(1.55 * treeScale, 0.78, 1.55 * treeScale),
            color: leafColor,
          },
          {
            position: new THREE.Vector3(x, crownBase + 0.72, z),
            scale: new THREE.Vector3(1.12 * treeScale, 0.72, 1.12 * treeScale),
            color: leafColor.clone().offsetHSL(0, 0, 0.025),
          },
          {
            position: new THREE.Vector3(x, crownBase + 1.34, z),
            scale: new THREE.Vector3(0.68 * treeScale, 0.58, 0.68 * treeScale),
            color: leafColor.clone().offsetHSL(0, 0, 0.05),
          },
        );
        treeCount += 1;
      } else if (
        height >= 1 &&
        height <= 8 &&
        slope <= 2 &&
        chance > 0.935 &&
        !nearWaterCourse(x, z)
      ) {
        shrubs.push({
          position: new THREE.Vector3(x, height + 0.53, z),
          scale: new THREE.Vector3(0.62, 0.48, 0.62),
          color: new THREE.Color(0x557052).offsetHSL(0, 0, (chance - 0.95) * 0.5),
        });
      }
    }
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  addFaceShading(geometry);
  const trunkMaterial = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true });
  const leafMaterial = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true });
  const shrubMaterial = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true });
  const trunkMesh = buildInstancedBoxes(geometry, trunkMaterial, trunks);
  const leafMesh = buildInstancedBoxes(geometry, leafMaterial, leaves);
  const shrubMesh = buildInstancedBoxes(geometry, shrubMaterial, shrubs);
  trunkMesh.castShadow = true;
  leafMesh.castShadow = true;
  shrubMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  leafMesh.receiveShadow = true;
  shrubMesh.receiveShadow = true;
  trunkMesh.name = "voxel-trunks";
  leafMesh.name = "voxel-foliage";
  shrubMesh.name = "voxel-shrubs";
  return {
    meshes: [trunkMesh, leafMesh, shrubMesh],
    count: trunks.length + leaves.length + shrubs.length,
  };
}

function addWaterCourse(
  grid: HeightGrid,
  config: {
    zStart: number;
    zEnd: number;
    width: number;
    path: (z: number) => number;
  },
  surface: BoxInstance[],
  falls: BoxInstance[],
  drops: DropSpan[],
) {
  let previousHeight = grid.get(config.path(config.zStart), config.zStart);
  let previousX = config.path(config.zStart);
  for (let z = config.zStart; z <= config.zEnd; z += 1) {
    const centerX = config.path(z);
    const height = grid.get(centerX, z);
    const lanes = config.width >= 2 ? [-0.72, 0, 0.72] : [0];
    for (const lane of lanes) {
      surface.push({
        position: new THREE.Vector3(centerX + lane, height + 0.53, z),
        scale: new THREE.Vector3(config.width >= 2 ? 0.68 : 0.9, 0.12, 0.96),
        color: new THREE.Color(hash2(z, lane * 9) > 0.5 ? 0x72c9dc : 0x5db4cc),
      });
    }

    const drop = previousHeight - height;
    if (drop > 1) {
      const top = previousHeight + 0.46;
      const bottom = height + 0.58;
      const fallX = (previousX + centerX) * 0.5;
      const fallZ = z - 0.36;
      for (const lane of lanes) {
        for (let y = top - 0.38; y > bottom; y -= 0.74) {
          falls.push({
            position: new THREE.Vector3(fallX + lane, y, fallZ),
            scale: new THREE.Vector3(config.width >= 2 ? 0.72 : 0.94, 0.8, 0.24),
            color: new THREE.Color(hash2(y * 4, z) > 0.4 ? 0x7fd6e5 : 0x58b7d0),
          });
        }
      }
      drops.push({ x: fallX, z: fallZ, top, bottom, width: config.width });
    }
    previousHeight = height;
    previousX = centerX;
  }
}

function buildWater(grid: HeightGrid) {
  const surface: BoxInstance[] = [];
  const falls: BoxInstance[] = [];
  const drops: DropSpan[] = [];

  addWaterCourse(
    grid,
    {
      zStart: -6,
      zEnd: 28,
      width: 2,
      path: (z) => -8 + Math.sin((z + 5) * 0.22) * 1.35,
    },
    surface,
    falls,
    drops,
  );
  addWaterCourse(
    grid,
    {
      zStart: -9,
      zEnd: 23,
      width: 1,
      path: (z) => 15 + Math.sin((z + 8) * 0.2 + 1.2) * 0.9,
    },
    surface,
    falls,
    drops,
  );

  for (let x = -15; x <= 1; x += 1) {
    for (let z = 25; z <= 35; z += 1) {
      const dx = (x + 7.5) / 8.5;
      const dz = (z - 29.5) / 5.8;
      const edgeNoise = (hash2(x * 2.1, z * 1.8) - 0.5) * 0.25;
      if (dx * dx + dz * dz < 0.88 + edgeNoise) {
        surface.push({
          position: new THREE.Vector3(x, 0.58, z),
          scale: new THREE.Vector3(0.96, 0.14, 0.96),
          color: new THREE.Color(hash2(x, z) > 0.45 ? 0x5eb7c8 : 0x69c3d0),
        });
      }
    }
  }
  for (let x = 11; x <= 20; x += 1) {
    for (let z = 21; z <= 28; z += 1) {
      const dx = (x - 15.5) / 5.3;
      const dz = (z - 24.5) / 4.2;
      if (dx * dx + dz * dz < 0.82 + (hash2(x, z) - 0.5) * 0.2) {
        surface.push({
          position: new THREE.Vector3(x, 0.59, z),
          scale: new THREE.Vector3(0.96, 0.14, 0.96),
          color: new THREE.Color(0x65bdcf).offsetHSL(0, 0, (hash2(z, x) - 0.5) * 0.06),
        });
      }
    }
  }

  const surfaceMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd3e7,
    transparent: true,
    opacity: 0.88,
    vertexColors: false,
    depthWrite: false,
    toneMapped: false,
  });
  const fallMaterial = surfaceMaterial.clone();
  fallMaterial.opacity = 0.93;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const surfaceMesh = buildInstancedBoxes(geometry, surfaceMaterial, surface);
  const fallMesh = buildInstancedBoxes(geometry, fallMaterial, falls);
  surfaceMesh.renderOrder = 3;
  fallMesh.renderOrder = 3;
  surfaceMesh.name = "voxel-water-surface";
  fallMesh.name = "voxel-waterfalls";
  return {
    meshes: [surfaceMesh, fallMesh],
    surfaceMaterial,
    fallMaterial,
    drops,
    count: surface.length + falls.length,
  };
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildClouds(radialTexture: THREE.Texture | null) {
  const random = mulberry32(20260820);
  const near: BoxInstance[] = [];
  const far: BoxInstance[] = [];
  const spriteGroup = new THREE.Group();
  spriteGroup.name = "soft-mist";

  for (let cluster = 0; cluster < 36; cluster += 1) {
    const centerX = -42 + random() * 84;
    const centerZ = -26 + random() * 52;
    const centerY = 10.5 + random() * 6.4;
    const parts = 5 + Math.floor(random() * 5);
    const target = centerZ > 0 ? near : far;
    for (let part = 0; part < parts; part += 1) {
      target.push({
        position: new THREE.Vector3(
          Math.round((centerX + (random() - 0.5) * 9) * 2) / 2,
          Math.round((centerY + (random() - 0.5) * 2.4) * 2) / 2,
          Math.round((centerZ + (random() - 0.5) * 7) * 2) / 2,
        ),
        scale: new THREE.Vector3(3.2 + random() * 6.2, 0.55 + random() * 1.25, 2 + random() * 4.4),
        color: new THREE.Color(random() > 0.45 ? 0xe7ebe2 : 0xdce6e2),
      });
    }

    if (radialTexture && cluster % 2 === 0) {
      const material = new THREE.SpriteMaterial({
        map: radialTexture,
        color: cluster % 4 === 0 ? 0xe9eee7 : 0xd8e5e3,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(centerX, centerY, centerZ);
      const size = 12 + random() * 11;
      sprite.scale.set(size, size * 0.34, 1);
      spriteGroup.add(sprite);
    }
  }

  const frontAnchors = [
    [-25, 12.6, 13],
    [-13, 14.2, 16],
    [0, 12.4, 14],
    [13, 15.1, 15],
    [26, 11.8, 12],
  ];
  frontAnchors.forEach(([centerX, centerY, centerZ]) => {
    for (let part = 0; part < 9; part += 1) {
      near.push({
        position: new THREE.Vector3(
          Math.round((centerX + (random() - 0.5) * 10) * 2) / 2,
          Math.round((centerY + (random() - 0.5) * 2.2) * 2) / 2,
          Math.round((centerZ + (random() - 0.5) * 5) * 2) / 2,
        ),
        scale: new THREE.Vector3(3.8 + random() * 6.5, 0.65 + random() * 1.15, 2.6 + random() * 4),
        color: new THREE.Color(random() > 0.4 ? 0xf0f1e9 : 0xe1eae6),
      });
    }
  });

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const farMaterial = new THREE.MeshBasicMaterial({
    color: 0xe9eee8,
    transparent: true,
    opacity: 0.18,
    vertexColors: false,
    depthWrite: false,
  });
  const nearMaterial = farMaterial.clone();
  nearMaterial.opacity = 0.25;
  const farMesh = buildInstancedBoxes(geometry, farMaterial, far);
  const nearMesh = buildInstancedBoxes(geometry, nearMaterial, near);
  farMesh.renderOrder = 1;
  nearMesh.renderOrder = 4;
  farMesh.name = "voxel-clouds-far";
  nearMesh.name = "voxel-clouds-near";

  const group = new THREE.Group();
  group.name = "cloud-belt";
  group.add(farMesh, nearMesh, spriteGroup);
  return { group, count: far.length + near.length };
}

function buildFlowParticles(drops: DropSpan[], texture: THREE.Texture | null) {
  const particles: FlowParticle[] = [];
  const random = mulberry32(9317);
  drops.forEach((drop) => {
    const count = Math.max(5, Math.min(18, Math.round((drop.top - drop.bottom) * 2.4)));
    for (let index = 0; index < count; index += 1) {
      particles.push({
        ...drop,
        phase: random(),
        speed: 0.38 + random() * 0.6,
        lateral: (random() - 0.5) * drop.width * 0.75,
      });
    }
  });
  const positions = new Float32Array(particles.length * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: texture,
    color: 0xd6fbff,
    size: 0.32,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    alphaTest: 0.02,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 5;
  points.frustumCulled = false;
  points.name = "water-flow-particles";

  const update = (elapsed: number) => {
    particles.forEach((particle, index) => {
      const progress = fract(particle.phase + elapsed * particle.speed);
      positions[index * 3] = particle.x + particle.lateral + Math.sin(elapsed * 4 + index) * 0.035;
      positions[index * 3 + 1] = THREE.MathUtils.lerp(particle.top, particle.bottom, progress);
      positions[index * 3 + 2] = particle.z + 0.12 + Math.sin(elapsed * 2.2 + index * 0.7) * 0.025;
    });
    geometry.attributes.position.needsUpdate = true;
  };

  return { points, update };
}

function buildPoolMist(texture: THREE.Texture | null) {
  const random = mulberry32(4412);
  const count = 92;
  const positions = new Float32Array(count * 3);
  const data = Array.from({ length: count }, (_, index) => {
    const mainPool = index < 64;
    const centerX = mainPool ? -7.5 : 15.5;
    const centerZ = mainPool ? 28 : 23.5;
    const radius = mainPool ? 5.5 : 3.5;
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    return {
      x: centerX + Math.cos(angle) * distance,
      z: centerZ + Math.sin(angle) * distance * 0.6,
      phase: random(),
      rise: 0.22 + random() * 0.38,
    };
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: texture,
    color: 0xc8edf0,
    size: 1.25,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    alphaTest: 0.01,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 5;
  points.frustumCulled = false;
  points.name = "waterfall-mist";
  const update = (elapsed: number) => {
    data.forEach((particle, index) => {
      const progress = fract(particle.phase + elapsed * particle.rise);
      positions[index * 3] = particle.x + Math.sin(elapsed * 0.8 + index) * progress * 0.35;
      positions[index * 3 + 1] = 0.72 + progress * 2.2;
      positions[index * 3 + 2] = particle.z + Math.cos(elapsed * 0.7 + index) * progress * 0.25;
    });
    geometry.attributes.position.needsUpdate = true;
  };
  return { points, update };
}

function buildAtmosphericDust(texture: THREE.Texture | null) {
  const random = mulberry32(7801);
  const count = 170;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 108;
    positions[index * 3 + 1] = 3 + random() * 31;
    positions[index * 3 + 2] = (random() - 0.5) * 88;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: texture,
    color: 0xffe4b1,
    size: 0.18,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = "sunlit-dust";
  return points;
}

function buildSky() {
  const geometry = new THREE.SphereGeometry(175, 32, 18);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x607d8a) },
      horizonColor: { value: new THREE.Color(0xbcc8bd) },
      lowerColor: { value: new THREE.Color(0x829b9b) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 lowerColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 lowerMix = mix(lowerColor, horizonColor, smoothstep(-0.35, 0.12, h));
        vec3 finalColor = mix(lowerMix, topColor, smoothstep(0.02, 0.82, h));
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "gradient-sky";
  return mesh;
}

export default function VoxelLandscape({
  touring,
  onReady,
  onMetrics,
  onError,
}: VoxelLandscapeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const touringRef = useRef(touring);
  const callbacksRef = useRef({ onReady, onMetrics, onError });

  useEffect(() => {
    touringRef.current = touring;
  }, [touring]);

  useEffect(() => {
    callbacksRef.current = { onReady, onMetrics, onError };
  }, [onReady, onMetrics, onError]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let controls: OrbitControls | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    const disposableTextures: THREE.Texture[] = [];
    let disposed = false;

    try {
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0xa5b5af, 0.0065);

      const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 350);
      camera.position.set(-68, 39, 78);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      const preferredPixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
      renderer.setPixelRatio(preferredPixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0x9daea9, 1);
      renderer.domElement.dataset.testid = "voxel-canvas";
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute(
        "aria-label",
        "由体素块构成的群山、瀑布、云海和山脚森林，镜头会自动缓慢环绕",
      );
      mount.appendChild(renderer.domElement);

      const sky = buildSky();
      scene.add(sky);

      const sunTexture = createRadialTexture("rgba(255,235,184,1)", "rgba(255,205,128,0)");
      if (sunTexture) disposableTextures.push(sunTexture);
      const sunMaterial = new THREE.SpriteMaterial({
        map: sunTexture,
        color: 0xffe1a7,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sunSprite = new THREE.Sprite(sunMaterial);
      sunSprite.position.set(-72, 49, -68);
      sunSprite.scale.set(24, 24, 1);
      scene.add(sunSprite);

      const hemisphere = new THREE.HemisphereLight(0xeaf2ec, 0x273338, 2.35);
      scene.add(hemisphere);
      const keyLight = new THREE.DirectionalLight(0xffd2a0, 3.8);
      keyLight.position.set(-38, 58, 32);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 145;
      keyLight.shadow.camera.left = -55;
      keyLight.shadow.camera.right = 55;
      keyLight.shadow.camera.top = 55;
      keyLight.shadow.camera.bottom = -40;
      keyLight.shadow.bias = -0.00035;
      keyLight.shadow.normalBias = 0.025;
      scene.add(keyLight, keyLight.target);
      keyLight.target.position.set(0, 8, 0);
      const rimLight = new THREE.DirectionalLight(0x8fc2d2, 0.72);
      rimLight.position.set(35, 25, -38);
      scene.add(rimLight);

      const grid = createHeightGrid();
      const pixelTexture = createPixelTexture();
      if (pixelTexture) disposableTextures.push(pixelTexture);
      const terrain = buildTerrain(grid, pixelTexture);
      scene.add(terrain.mesh);

      const vegetation = buildVegetation(grid);
      vegetation.meshes.forEach((mesh) => scene.add(mesh));

      const water = buildWater(grid);
      water.meshes.forEach((mesh) => scene.add(mesh));

      const mistTexture = createRadialTexture("rgba(255,255,255,0.92)", "rgba(255,255,255,0)", 64);
      if (mistTexture) disposableTextures.push(mistTexture);
      const clouds = buildClouds(mistTexture);
      scene.add(clouds.group);

      const flow = buildFlowParticles(water.drops, mistTexture);
      const poolMist = buildPoolMist(mistTexture);
      const dust = buildAtmosphericDust(mistTexture);
      scene.add(flow.points, poolMist.points, dust);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 10.5, 1);
      controls.enableDamping = true;
      controls.dampingFactor = 0.045;
      controls.enablePan = false;
      controls.minDistance = 56;
      controls.maxDistance = 118;
      controls.minPolarAngle = Math.PI * 0.2;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.28;
      controls.update();

      const resize = () => {
        if (!renderer || !mount) return;
        const width = Math.max(1, mount.clientWidth);
        const height = Math.max(1, mount.clientHeight);
        camera.aspect = width / height;
        camera.fov = width / height < 0.78 ? 51 : 43;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
      resize();

      const clock = new THREE.Clock();
      let frames = 0;
      let metricStartedAt = performance.now();
      let lowFpsSamples = 0;
      let quality: SceneMetrics["quality"] = "high";
      let currentFps = 60;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const totalVoxels =
        terrain.count + water.count + clouds.count + vegetation.count;

      const makeMetrics = (): SceneMetrics => ({
        fps: Math.round(currentFps),
        terrainVoxels: terrain.count,
        waterVoxels: water.count,
        cloudVoxels: clouds.count,
        vegetationVoxels: vegetation.count,
        totalVoxels,
        drawCalls: renderer?.info.render.calls ?? 0,
        triangles: renderer?.info.render.triangles ?? 0,
        pixelRatio: Number((renderer?.getPixelRatio() ?? 1).toFixed(2)),
        quality,
      });

      const initialMetrics = makeMetrics();
      window.__VOXEL_SCENE_METRICS__ = initialMetrics;
      mount.dataset.ready = "true";
      mount.dataset.terrainVoxels = String(terrain.count);
      mount.dataset.waterVoxels = String(water.count);
      mount.dataset.cloudVoxels = String(clouds.count);
      mount.dataset.vegetationVoxels = String(vegetation.count);
      document.documentElement.dataset.sceneReady = "true";
      callbacksRef.current.onReady(initialMetrics);

      const animate = () => {
        if (disposed || !renderer || !controls) return;
        animationFrame = requestAnimationFrame(animate);
        const elapsed = clock.getElapsedTime();
        controls.autoRotate = touringRef.current && !reducedMotion.matches;
        controls.update();

        clouds.group.position.x = Math.sin(elapsed * 0.055) * 1.8;
        clouds.group.position.z = Math.cos(elapsed * 0.043) * 1.1;
        clouds.group.rotation.y = Math.sin(elapsed * 0.025) * 0.018;
        dust.rotation.y = elapsed * 0.007;
        flow.update(elapsed);
        poolMist.update(elapsed);
        water.surfaceMaterial.opacity = 0.84 + Math.sin(elapsed * 2.1) * 0.05;
        water.fallMaterial.opacity = 0.9 + Math.sin(elapsed * 2.8 + 0.6) * 0.05;

        renderer.render(scene, camera);
        frames += 1;
        const now = performance.now();
        if (now - metricStartedAt >= 1000) {
          currentFps = (frames * 1000) / (now - metricStartedAt);
          frames = 0;
          metricStartedAt = now;

          if (currentFps < 34 && now > 4500 && renderer.getPixelRatio() > 1.01) {
            lowFpsSamples += 1;
            if (lowFpsSamples >= 2) {
              renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.2));
              quality = "adaptive";
              lowFpsSamples = 0;
              resize();
            }
          } else {
            lowFpsSamples = Math.max(0, lowFpsSamples - 1);
          }

          const metrics = makeMetrics();
          window.__VOXEL_SCENE_METRICS__ = metrics;
          callbacksRef.current.onMetrics(metrics);
        }
      };
      animate();

      const handleContextLost = (event: Event) => {
        event.preventDefault();
        callbacksRef.current.onError("WebGL 上下文意外中断，请刷新页面重试。");
      };
      renderer.domElement.addEventListener("webglcontextlost", handleContextLost);

      return () => {
        disposed = true;
        cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        renderer?.domElement.removeEventListener("webglcontextlost", handleContextLost);
        controls?.dispose();
        scene.traverse((object) => {
          const candidate = object as THREE.Mesh;
          if (candidate.geometry) candidate.geometry.dispose();
          if (candidate.material) {
            const materials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
            materials.forEach((material) => material.dispose());
          }
        });
        disposableTextures.forEach((texture) => texture.dispose());
        renderer?.dispose();
        renderer?.domElement.remove();
        delete window.__VOXEL_SCENE_METRICS__;
        delete document.documentElement.dataset.sceneReady;
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知渲染错误";
      callbacksRef.current.onError(`场景初始化失败：${message}`);
      renderer?.dispose();
      renderer?.domElement.remove();
    }
  }, []);

  return <div ref={mountRef} className="scene-mount" data-testid="scene-root" />;
}
