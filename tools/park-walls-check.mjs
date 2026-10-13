// THE PARK WALLS CHECK — steep faces block, everything else rides.
//
// `ParkSurface.blocked()` answers from a downward raycast alone (the rips
// name nothing, so there are no analytic solids to ask), and a raycast rule
// this short is exactly where a wrong threshold hides: too eager and the
// transitions read as walls, too lax and the funboxes read as air. So every
// clause of the rule has a case here, driven against SYNTHETIC geometry (a
// headless scene — three.js raycasts need no DOM, no GPU, no GLB):
//
//   floor → false · kerb 0.15 → false · ledge 0.45 → true · wall 3 m → true
//   tower 10 m → FALSE (documented limit: faces over 4 m up read as decks)
//   QP arc face, y tracking the surface → false at every sample
//   deck 6 m overhead → false (ridden under) · low deck 3 m → TRUE
//   (documented trade: cover under 4 m reads as a wall from below)
//   down-facing plane → false (ceilings are ridden under, never hit)
//
// Run: node --experimental-strip-types tools/park-walls-check.mjs

import { register } from "node:module";
import * as THREE from "three";

register(new URL("./ts-resolve.mjs", import.meta.url));

const { ParkSurface } = await import("../src/world/parks.ts");

const results = [];
const check = (name, pass, detail, proof) => {
  results.push({ name, pass, proof: proof ?? null });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}` +
      (proof ? "" : "   [UNPROVEN — never watched failing]"),
  );
};

function box(w, h, d, x, y, z, up = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.set(x, y, z);
  if (!up) m.rotation.z = Math.PI;
  m.updateMatrixWorld(true);
  return m;
}

const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200));
floor.geometry.rotateX(-Math.PI / 2);
floor.updateMatrixWorld(true);

// A transition face as a solid wedge: arc profile R=3 to 80°, extruded 6 m.
// Riding UP it must never read as a wall; its vertical back must.
const R = 3;
const shape = new THREE.Shape();
shape.moveTo(0, 0);
for (let a = 0; a <= 80; a += 5) {
  const r = (a * Math.PI) / 180;
  shape.lineTo(R * Math.sin(r), R * (1 - Math.cos(r)));
}
const topX = R * Math.sin((80 * Math.PI) / 180);
shape.lineTo(topX, 0);
shape.closePath();
const wedgeGeo = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false });
wedgeGeo.translate(-30, 0, -3);
const wedge = new THREE.Mesh(wedgeGeo);
wedge.updateMatrixWorld(true);

const meshes = [
  floor,
  box(2, 0.15, 2, 10, 0.075, 0), // kerb
  box(2, 0.45, 2, -10, 0.225, 0), // ledge
  box(2, 3, 2, 0, 1.5, -10), // wall
  box(2, 10, 2, 0, 5, 10), // tower (over the window)
  wedge, // transition at x≈-30
  box(6, 0.3, 6, -20, 5.85, 0), // deck 6 m up
  box(6, 0.3, 6, 20, 2.85, 0), // low deck 3 m up
  wedge,
];
const downPlane = new THREE.Mesh(new THREE.PlaneGeometry(6, 6));
downPlane.geometry.rotateX(Math.PI / 2); // faces DOWN: a ceiling
downPlane.position.set(-20, 2, 10);
downPlane.material.side = THREE.DoubleSide;
downPlane.updateMatrixWorld(true);
meshes.push(downPlane);

const surf = new ParkSurface();
surf.setMeshes(meshes);

check(
  "open floor blocks nothing",
  surf.blocked(0, 30, 0) === false,
  "slab at (0, 30)",
  "src/world/parks.ts `blocked` — return true unconditionally — every case below fails with it",
);
check(
  "a 0.15 kerb is bumped over, not a wall",
  surf.blocked(10, 0, 0) === false,
  "kerb top 0.15 over 0.3",
  "src/world/parks.ts `blocked` — threshold 0.3 → 0.05 — kerb reads as a wall",
);
check(
  "a 0.45 ledge side is a wall",
  surf.blocked(-10, 0, 0) === true,
  "ledge top 0.45 inside (0.3, 4.0]",
  "src/world/parks.ts `blocked` — threshold 0.3 → 5 — the ledge lets him through",
);
check(
  "a 3 m wall is a wall",
  surf.blocked(0, -10, 0) === true,
  "wall top 3.0 inside (0.3, 4.0]",
  "src/world/parks.ts `blocked` — window 4.0 → 0.2 — the wall lets him through",
);
check(
  "a 10 m tower is NOT a wall (documented limit)",
  surf.blocked(0, 10, 0) === false,
  "tower top 10.0 over the 4.0 window — reads as a deck, ridden under",
  "src/world/parks.ts `blocked` — window 4.0 → 100 — the tower blocks the sky",
);

// Up the transition face with y tracking the surface: never a wall.
{
  const samples = [];
  let ok = true;
  for (let a = 10; a <= 75; a += 13) {
    const r = (a * Math.PI) / 180;
    const x = -30 + R * Math.sin(r);
    const y = R * (1 - Math.cos(r));
    const blocked = surf.blocked(x, 0, y);
    samples.push(`${a}°:${blocked ? "WALL" : "ride"}`);
    if (blocked) ok = false;
  }
  check(
    "a transition face never reads as a wall on the way up",
    ok,
    samples.join(" · "),
    "src/world/parks.ts `blocked` — threshold 0.3 → 0.05 — the face blocks from 25° up",
  );
}

// …but its vertical back does. Probed just INSIDE the back plane (a probe
// outside it sees only floor — the walk asks about destinations, and a step
// INTO the wall is the one that must refuse).
check(
  "the wedge's vertical back is a wall",
  surf.blocked(topX - 30 - 0.1, 0, 0) === true,
  `back face at x≈${(topX - 30).toFixed(2)}, probe 0.1 inside`,
  "src/world/parks.ts `blocked` — the back-face probe moved 2 m out — open floor, nothing to catch",
);

check(
  "a deck 6 m overhead is ridden under",
  surf.blocked(-20, 0, 0) === false,
  "deck top 6.0 over the 4.0 window",
  "src/world/parks.ts `blocked` — window 4.0 → 100 — the warehouse deck blocks its own floor",
);
check(
  "a low deck at 3 m reads as a wall (documented trade)",
  surf.blocked(20, 0, 0) === true,
  "deck top 3.0 inside (0.3, 4.0] — no shipped park has cover this low (sawmill max 0.72)",
  "src/world/parks.ts `blocked` — window 4.0 → 2.0 — the low deck lets him under",
);
check(
  "a down-facing ceiling is ridden under, never hit",
  surf.blocked(-20, 10, 0) === false,
  "plane normal −y skipped by the facing test",
  "src/world/parks.ts `blocked` — facing test deleted — the ceiling blocks its own room",
);

const failed = results.filter((r) => !r.pass);
const unproven = results.filter((r) => !r.proof);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(" · ")}`);
console.log(
  `${results.length - unproven.length}/${results.length} watched failing against deliberately broken code`,
);
process.exit(failed.length ? 1 : 0);
