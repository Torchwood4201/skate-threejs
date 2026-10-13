// Where a streamed park drops the skater once its geometry lands.
//
// The bbox middle is NOT a spawn: for roofed parks (the warehouse, the
// haunted house, sawmill's own roof) the middle is under a roof, which is
// exactly the "spawning under the map" report. A spawn has to be open ground
// with open sky, so this samples the normalised footprint on a coarse grid
// and scores each candidate three ways:
//
//   1. it must be ground, not a rooftop — lowest height wins;
//   2. it must be flat-ish — the four neighbours within ±1.5 m agree to 0.6 m;
//   3. it must have headroom — an up-ray from chest height travels 8 m
//      without hitting anything (no roof, no awning, no bridge deck).
//
// The winner faces the footprint middle, so the first thing a fresh spawn
// sees is the park, not the slab edge. Fully roofed (no candidate clears
// headroom): the lowest flat point still wins — under a roof but on the
// floor, which is no worse than today, and the reseat in `goToSpot` still
// fires so R lands somewhere sane.
//
// Own module with zero deps beyond three, so the headless harness
// (`tools/park-spawn-check.mjs`) can drive it against synthetic geometry
// without importing the world.

import * as THREE from "three";

export interface ParkSpawn {
  x: number;
  z: number;
  /** Yaw, radians. Forward is (sin heading, 0, cos heading). */
  heading: number;
}

/** Half-extent of the normalised footprint all three parks are scaled to. */
const HALF = 35;
/** Coarse pass step — 11×11 candidates, then refine around the winner. */
const STEP = 7;
/** Refine pass step around the coarse winner. */
const FINE = 1.75;
/** Flatness window: neighbours must agree within this, metres. */
const FLAT = 0.6;
/** Chest height the headroom ray starts above the ground. */
const CHEST = 1.2;
/** Headroom required: open sky for this far above the chest, metres. */
const SKY = 8;

const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3();

function groundAt(meshes: THREE.Object3D[], x: number, z: number, yHint: number): number | null {
  _origin.set(x, yHint + 12, z);
  _ray.set(_origin, _down);
  _ray.far = 80;
  const hits = _ray.intersectObjects(meshes, false);
  for (const h of hits) {
    if (h.point.y <= yHint + 2.0) return h.point.y;
  }
  return null;
}

function headroomClear(meshes: THREE.Object3D[], x: number, y: number, z: number): boolean {
  _origin.set(x, y + CHEST, z);
  _ray.set(_origin, _up);
  _ray.far = SKY;
  return _ray.intersectObjects(meshes, false).length === 0;
}

interface Candidate {
  x: number;
  z: number;
  h: number;
  flat: boolean;
  sky: boolean;
}

function survey(meshes: THREE.Object3D[], cx: number, cz: number, step: number): Candidate[] {
  const out: Candidate[] = [];
  for (let gx = -HALF; gx <= HALF + 1e-6; gx += step) {
    for (let gz = -HALF; gz <= HALF + 1e-6; gz += step) {
      const h = groundAt(meshes, cx + gx, cz + gz, 2);
      if (h === null) continue;
      out.push({ x: cx + gx, z: cz + gz, h, flat: false, sky: false });
    }
  }
  return out;
}

function judge(meshes: THREE.Object3D[], c: Candidate): void {
  // Flatness first (4 rays), headroom after (1 ray) — the ray up is the
  // expensive question and most candidates fail flatness first.
  // NOTE: neighbours are read with the same yHint discipline as the centre
  // so a ledge top does not compare itself against the plaza beside it.
  const ns = [
    groundAt(meshes, c.x + 1.5, c.z, c.h),
    groundAt(meshes, c.x - 1.5, c.z, c.h),
    groundAt(meshes, c.x, c.z + 1.5, c.h),
    groundAt(meshes, c.x, c.z - 1.5, c.h),
  ];
  c.flat = ns.every((n) => n !== null && Math.abs(n - c.h) < FLAT);
  if (c.flat) c.sky = headroomClear(meshes, c.x, c.h, c.z);
}

function score(c: Candidate): number {
  // Ground beats rooftop (×3 per metre), centre beats edge (a stroll in).
  // Disqualified (no sky) scores +1000 — still ordered, so a fully roofed
  // park degrades to "lowest flat floor" instead of nowhere.
  return c.h * 3 + Math.hypot(c.x, c.z) * 0.03 + (c.sky ? 0 : 1000);
}

/**
 * Topmost up-facing surface over (x, z), or null when the column is empty.
 * Unlike `groundAt` (which dives under anything above yHint+2 for ledge
 * riding), this answers "what is the highest thing here" — the seating
 * question. `meshes` must EXCLUDE the fallback slab, or every column answers
 * the slab and the middle of an elevated deck reads as the floor under it.
 */
export function columnTop(meshes: THREE.Object3D[], x: number, z: number): number | null {
  if (meshes.length === 0) return null;
  _origin.set(x, 200, z);
  _ray.set(_origin, _down);
  _ray.far = 400;
  const hits = _ray.intersectObjects(meshes, false);
  const n = new THREE.Vector3();
  for (const h of hits) {
    const face = (h as { face?: { normal: THREE.Vector3 } | null }).face;
    if (!face) continue;
    n.copy(face.normal).transformDirection(h.object.matrixWorld);
    if (n.y > 0.3) return h.point.y;
  }
  return null;
}

/**
 * The middle of the map, standing on TOP of it. Samples the centre plus a
 * 2 m ring (so a pole or seam exactly at origin can't win) and takes the
 * highest up-facing top. Verified against the real files
 * (`tools/park-spawn-check.mjs`): warehouse ≈ 13.9 (broad deck, flat ±12 m),
 * haunted ≈ 15.3, sawmill ≈ 0.2. Null when the middle column holds no
 * geometry at all — the caller falls back to `pickParkSpawn` open ground.
 */
export function pickMiddleTop(meshes: THREE.Object3D[]): { x: number; z: number; ground: number } | null {
  const spots: Array<[number, number]> = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [1.4, 1.4],
    [-1.4, 1.4],
    [1.4, -1.4],
    [-1.4, -1.4],
  ];
  let best: { x: number; z: number; ground: number } | null = null;
  for (const [x, z] of spots) {
    const t = columnTop(meshes, x, z);
    if (t === null) continue;
    if (best === null || t > best.ground) best = { x, z, ground: t };
  }
  return best;
}

/**
 * Pick the spawn for a normalised park (footprint centred on origin,
 * ~±35 m). `meshes` is the raycast set — park geometry plus the slab, so a
 * down-ray always finds at least 0 and there is always an answer.
 */
export function pickParkSpawn(meshes: THREE.Object3D[]): ParkSpawn {
  if (meshes.length === 0) return { x: 0, z: 0, heading: 0 };
  const coarse = survey(meshes, 0, 0, STEP);
  if (coarse.length === 0) return { x: 0, z: 0, heading: 0 };
  for (const c of coarse) judge(meshes, c);
  coarse.sort((a, b) => score(a) - score(b));
  const winner = coarse[0]!;
  // Refine around the winner: the coarse grid can strand the spawn 5 m from
  // a wall it could have stood 2 m further from.
  const fine = survey(meshes, winner.x, winner.z, FINE).filter(
    (c) => Math.abs(c.x - winner.x) <= STEP && Math.abs(c.z - winner.z) <= STEP,
  );
  let best = winner;
  if (fine.length > 0) {
    for (const c of fine) judge(meshes, c);
    fine.sort((a, b) => score(a) - score(b));
    if (score(fine[0]!) < score(winner)) best = fine[0]!;
  }
  // Face the middle: the first frame is the park, not the fog.
  const dx = 0 - best.x;
  const dz = 0 - best.z;
  const heading = dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz);
  return { x: best.x, z: best.z, heading };
}
