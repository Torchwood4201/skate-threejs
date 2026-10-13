// THE PARK SPAWN CHECK — open ground under open sky, never under a roof.
//
// The "spawning under the map" report: `goToSpot` seats the player before a
// streamed park's geometry arrives, and the old spawn was the bbox middle —
// under the building on every roofed park. `pickParkSpawn` (src/world/
// park-spawn.ts) samples the footprint for flat ground with headroom instead.
// This drives it against SYNTHETIC geometry (a roof slab on stilts over a
// floor, plus a freestanding tall block), because the real GLBs need a GPU
// context to load and the rule under test is pure raycast logic.
//
// Run: node --experimental-strip-types tools/park-spawn-check.mjs

import { register } from "node:module";
import * as THREE from "three";

register(new URL("./ts-resolve.mjs", import.meta.url));

const { pickParkSpawn } = await import("../src/world/park-spawn.ts");

let failed = 0;
function check(name, pass, detail) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failed++;
}

function box(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.set(x, y, z);
  m.updateMatrixWorld(true);
  return m;
}

// A warehouse in miniature: 70×70 floor slab at y=0, a 30×30 roof plate at
// y=6 held over the MIDDLE (the old spawn), one solid 8 m block off to the
// side. Correct answer: anywhere on the floor outside both footprints.
const floor = box(70, 0.2, 70, 0, -0.1, 0);
const roof = box(30, 0.5, 30, 0, 6, 0);
const stilts = [-14, 14].flatMap((sx) => [-14, 14].map((sz) => box(1, 6, 1, sx, 3, sz)));
const block = box(8, 8, 8, 20, 4, -18);
const meshes = [floor, roof, ...stilts, block];

const spawn = pickParkSpawn(meshes);
console.log(`spawn: (${spawn.x.toFixed(2)}, ${spawn.z.toFixed(2)}) heading ${(spawn.heading * 180 / Math.PI).toFixed(1)}°`);

// 1. Not under the roof footprint (30 wide, centred): outside ±15. The
//    picker guarantees open sky above, not distance from edges — a spawn
//    0.75 m past the edge with clear headroom is a correct answer.
const underRoof = Math.abs(spawn.x) < 15 && Math.abs(spawn.z) < 15;
check(
  "spawn is not under the roof",
  !underRoof,
  `(${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)}) vs roof footprint ±15`,
);

// 2. Not inside the block: 8 wide at (20, -18) → keep 5 m clear.
const inBlock = Math.abs(spawn.x - 20) < 5 && Math.abs(spawn.z + 18) < 5;
check("spawn is clear of the block", !inBlock, `vs block (20, -18)±5`);

// 3. Headroom, verified independently of the picker: an up-ray from the
//    spawn travels 8 m clean.
{
  const ray = new THREE.Raycaster(
    new THREE.Vector3(spawn.x, 1.2, spawn.z),
    new THREE.Vector3(0, 1, 0),
    0,
    8,
  );
  const hits = ray.intersectObjects(meshes, false);
  check("8 m of open sky above the spawn", hits.length === 0, `${hits.length} hit(s)`);
}

// 4. On the floor, not floating: down-ray from +14 lands within 0.5 m of 0.
{
  const ray = new THREE.Raycaster(
    new THREE.Vector3(spawn.x, 14, spawn.z),
    new THREE.Vector3(0, -1, 0),
    0,
    80,
  );
  const hits = ray.intersectObjects(meshes, false);
  const y = hits.length > 0 ? hits[0].point.y : null;
  check(
    "spawn stands on the floor",
    y !== null && Math.abs(y) < 0.5,
    `ground at ${y === null ? "nothing" : y.toFixed(2)}`,
  );
}

// 5. Faces the middle: heading (sin, cos convention) points at the origin
//    within 45°. A spawn facing the fog is a spawn facing the wrong way.
{
  const dx = 0 - spawn.x;
  const dz = 0 - spawn.z;
  const want = Math.atan2(dx, dz);
  let diff = Math.abs(want - spawn.heading) % (Math.PI * 2);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  check(
    "spawn faces the park",
    diff < Math.PI / 4,
    `off by ${((diff * 180) / Math.PI).toFixed(1)}°`,
  );
}

// 6. Empty input degrades, never throws: no meshes → origin, heading 0.
{
  const s = pickParkSpawn([]);
  check(
    "empty mesh list falls back to origin",
    s.x === 0 && s.z === 0 && s.heading === 0,
    `(${s.x}, ${s.z}) h=${s.heading}`,
  );
}

// 7. Fully roofed degrades to the lowest flat floor, not nowhere: floor plus
//    a site-wide lid at y=10. The answer must be ON the floor (y≈0 by the
//    independent down-ray) even though every headroom check fails.
{
  const lid = box(70, 0.5, 70, 0, 10, 0);
  const s = pickParkSpawn([floor, lid]);
  const ray = new THREE.Raycaster(new THREE.Vector3(s.x, 14, s.z), new THREE.Vector3(0, -1, 0), 0, 80);
  const hits = ray.intersectObjects([floor, lid], false);
  // First hit below yHint-discipline: walk to the floor (lid at 10 is above
  // any sane hint; the picker scores height, so it should sit at ~0).
  const floorHit = hits.find((h) => h.point.y < 4);
  check(
    "fully roofed still lands on the floor",
    floorHit !== undefined && Math.abs(floorHit.point.y) < 0.5,
    `floor under spawn at ${floorHit ? floorHit.point.y.toFixed(2) : "nothing"}`,
  );
}

console.log(failed === 0 ? "\n7/7 passed" : `\nFAILED: ${failed}`);

// --- real geometry: the middle of each zip park ------------------------------
 //
// The player's instruction is "drop me in the middle", so the middle-column
// top of each shipped file is pinned here. These parse the REAL GLBs from
// public/parks (textures stripped in-memory — headless node has no image
// decoder — geometry untouched), run dressPark's own normalisation, and
// assert `pickMiddleTop`. If the zip changes, this fails LOUDLY instead of
// seating the player under the new geometry.
{
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { readFileSync } = await import("node:fs");
  const { pickMiddleTop } = await import("../src/world/park-spawn.ts");

  function stripTextures(buf) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const jlen = view.getUint32(12, true);
    const js = JSON.parse(Buffer.from(buf.subarray(20, 20 + jlen)).toString("utf8"));
    const strip = (o) => {
      if (Array.isArray(o)) return o.forEach(strip);
      if (o && typeof o === "object") {
        for (const k of [
          "baseColorTexture",
          "metallicRoughnessTexture",
          "normalTexture",
          "occlusionTexture",
          "emissiveTexture",
        ])
          delete o[k];
        delete o.extensions;
        Object.values(o).forEach(strip);
      }
    };
    (js.materials ?? []).forEach(strip);
    delete js.images;
    delete js.textures;
    delete js.samplers;
    const jb = Buffer.from(JSON.stringify(js));
    const pad = (4 - (jb.length % 4)) % 4;
    const jbPadded = Buffer.concat([jb, Buffer.alloc(pad, 0x20)]);
    const bin = buf.subarray(20 + jlen);
    const out = Buffer.alloc(12 + 8 + jbPadded.length + bin.length);
    const ov = new DataView(out.buffer, out.byteOffset, out.byteLength);
    ov.setUint32(0, 0x46546c67, true);
    ov.setUint32(4, 2, true);
    ov.setUint32(8, out.length, true);
    ov.setUint32(12, jbPadded.length, true);
    ov.setUint32(16, 0x4e4f534a, true);
    jbPadded.copy(out, 20);
    bin.copy(out, 20 + jbPadded.length);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  }

  // Mirrors dressPark's normalisation (src/world/parks.ts) — same span, same
  // clamp, same recenter. If that math changes, update both.
  async function loadParkMeshes(file) {
    const raw = readFileSync(new URL(file, import.meta.url));
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(stripTextures(raw), "");
    const inner = new THREE.Group();
    inner.add(...[...gltf.scene.children]);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1);
    const s = THREE.MathUtils.clamp(70 / span, 0.004, 2);
    inner.scale.setScalar(s);
    inner.position.x -= center.x * s;
    inner.position.z -= center.z * s;
    inner.position.y -= box.min.y * s;
    inner.updateMatrixWorld(true);
    const meshes = [];
    inner.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    return meshes;
  }

  const expected = [
    ["../public/parks/Skateparks/saw_mill_skatepark.glb", 0.17],
    ["../public/parks/Skateparks/thps_warehouse.glb", 13.87],
    // Haunted's dead-centre reads 15.3, but the 2 m ring finds the top of the
    // same central mass at 17.9 (4×4 m+ of deck around it — verified by grid
    // scan, not a spike). The picker takes the highest, so pin that.
    ["../public/parks/Skateparks/thps_3_haunted_house.glb", 17.9],
  ];
  for (const [file, want] of expected) {
    let mid = null;
    try {
      mid = pickMiddleTop(await loadParkMeshes(file));
    } catch (e) {
      check(`middle-top of ${file.split("/").pop()}`, false, `parse failed: ${e.message.split("\n")[0]}`);
      continue;
    }
    const ok = mid !== null && Math.abs(mid.ground - want) < 2 && Math.hypot(mid.x, mid.z) < 2.6;
    check(
      `middle-top of ${file.split("/").pop()} ≈ ${want}`,
      ok,
      mid === null ? "void column" : `(${mid.x.toFixed(2)}, ${mid.z.toFixed(2)}) @ ${mid.ground.toFixed(2)}`,
    );
  }

  // Rails derive off the same meshes: sawmill's named-group rip yields real
  // rails and ledges (pinned 8–20 — measured 14); the THPS rips arrive one
  // mesh per material (whole areas in one bbox), so nothing there qualifies —
  // and must not, because a line across a 40 m "ledge" would catch ollies
  // clearing it. Every derived line is level, ≥3 m, and the list is capped.
  const { deriveParkRails } = await import("../src/world/parks.ts");
  for (const [file, minRails, maxRails] of [
    ["../public/parks/Skateparks/saw_mill_skatepark.glb", 8, 20],
    ["../public/parks/Skateparks/thps_warehouse.glb", 0, 0],
    ["../public/parks/Skateparks/thps_3_haunted_house.glb", 0, 0],
  ]) {
    let rails = null;
    try {
      rails = deriveParkRails(await loadParkMeshes(file));
    } catch (e) {
      check(`rails of ${file.split("/").pop()}`, false, `parse failed: ${e.message.split("\n")[0]}`);
      continue;
    }
    const shape = rails.every(
      (r) =>
        Math.abs(r.a.y - r.b.y) < 0.3 &&
        Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) >= 2.5 &&
        (r.kind === "rail" || r.kind === "ledge"),
    );
    check(
      `rails of ${file.split("/").pop()}: ${rails.length} level lines` +
        (minRails > 0 ? ` (expected ${minRails}–${maxRails})` : " (none expected — merged chunks)"),
      rails.length >= minRails && rails.length <= maxRails && shape,
      `${rails.length} lines, all level+long: ${shape}`,
    );
  }
}

const failed2 = failed;
console.log(failed2 === 0 ? "all passed" : `\nFAILED: ${failed2}`);
process.exit(failed2 === 0 ? 0 : 1);
