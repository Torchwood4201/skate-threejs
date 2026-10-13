// The zip parks — three Sketchfab rips the player handed over, as three
// skateable spots next to the street block.
//
// WHAT THEY ARE: `saw_mill_skatepark` (92 m across, near-metres), the THPS
// warehouse and the THPS haunted house (both ~3000 units across — centimetre
// scale). Triangle counts are tiny (2.6k–9.4k); the cost is all in the images
// (27–76 per file, but the files are 0.9–1.7 MB total, so the images are
// small). No retail data, no conversion pipeline: the GLBs live in
// `public/parks/` and stream on demand when their spot is picked.
//
// HOW THEY RIDE: the ride only ever asks a `SurfaceProvider` how high the
// floor is, so a park answers by raycasting down against its own meshes —
// ramps, bowls and decks all ride for free, with no analytic description to
// keep in step with the mesh. What this does NOT give, deliberately:
//
// · **Grind lines are derived, not authored.** The rips name nothing, so
//   `deriveParkRails` reads long-low-narrow boxes as rails/ledges (wide pads
//   and funbox tops are skipped on purpose — a line across one's middle would
//   catch ollies clearing it). Flat bars still ollie onto and roll across as
//   geometry either way.
// · **No walls (v1).** `blocked()` is false; the slab is 260 m across and
//   `softEdge` steers him back at 55 m, so the worst case is a ride across
//   flat concrete, not out of the world.
// · **One sky for every park.** The street's own golden-hour panorama is
//   installed in `dress`, so the light rig and the picture behind it agree
//   and no new art is owed.
//
// SCALE: each file is normalised on load — XZ extent to ~70 m, min-Y to the
// slab — so a centimetre file and a metre file ride the same. The spawn is
// the middle of the map, standing ON TOP of the middle column (the player's
// instruction): the middle tops are broad decks (warehouse ≈ 13.9, haunted ≈
// 15.3), and the seating rule would otherwise dive under them to the slab —
// the "below the map" report. A 1.5 m pedestal in `cast()` makes the seating
// query land the deck; `goToSpot` re-seats once the stream lands (see
// main.ts) — the synchronous `reset()` at switch time only ever knew the
// empty slab.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { QualityTier } from "../controllers/quality/tier";
import type { GenexGltfLoader } from "../controllers/quality/gltf-loader";
import { loadTextureWithFallback } from "../controllers/quality/pick-asset";
import type {
  GrindLine,
  SurfaceKind,
  SurfaceProvider,
  SurfaceSample,
} from "./surface";
import { makeSample } from "./surface";
import type { Field } from "./field";
import type { GameMap, MapId } from "./maps";
import { CITY_SKYBOX_URL, type Furniture } from "./props";
import { installPanoramaSky } from "./sky/panorama";
import { pickMiddleTop, pickParkSpawn } from "./park-spawn";
import type { PropKind } from "./spot";

export type ParkId = "sawmill" | "warehouse" | "haunted";
export type ParkMapId = MapId | ParkId;

interface ParkDef {
  id: ParkId;
  name: string;
  blurb: string;
  file: string;
}

const PARKS: readonly ParkDef[] = [
  {
    id: "sawmill",
    name: "Saw Mill Park",
    blurb: "Wood ramps and concrete under a roof.",
    file: "saw_mill_skatepark.glb",
  },
  {
    id: "warehouse",
    name: "Warehouse",
    blurb: "THPS flat floors, banks and rails.",
    file: "thps_warehouse.glb",
  },
  {
    id: "haunted",
    name: "Haunted House",
    blurb: "THPS park with big transitions.",
    file: "thps_3_haunted_house.glb",
  },
];

/** XZ extent every park is normalised to, metres — the street block is ~66 m. */
const PARK_SPAN = 70;

/**
 * Grind lines out of dumb geometry. The rips name nothing (`Object_3`,
 * `_x…-material`), so there is no honest authorial rail list — but a rail or
 * a ledge IS a shape: long in one horizontal axis (≥3 m), low (≤0.6 m tall)
 * and narrow across (≤1.2 m). Anything wider is a pad or a funbox top, and
 * deriving a line across the middle of one would lock ollies that were
 * clearing it — so those stay unrideable-as-rails, stated, not silent.
 * Round bars (cross-section ≤0.25 m) read as `rail`, the rest as `ledge`;
 * the line sits on the top centre, level by construction (bbox top).
 * Capped: the catch loop walks every line per step, and a park needs edges,
 * not hundreds of them.
 */
const MAX_PARK_RAILS = 24;

export function deriveParkRails(meshes: THREE.Object3D[]): GrindLine[] {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const out: GrindLine[] = [];
  for (const mesh of meshes) {
    if ((mesh as THREE.Mesh).isMesh !== true) continue;
    if (mesh.name === "park-slab") continue;
    box.setFromObject(mesh);
    box.getSize(size);
    box.getCenter(center);
    if (size.y > 0.6 || size.y < 0.05) continue;
    const longX = size.x >= size.z;
    const long = longX ? size.x : size.z;
    const wide = longX ? size.z : size.x;
    if (long < 3 || wide > 1.2) continue;
    const half = long / 2 - 0.2;
    const y = box.max.y;
    const a = longX
      ? new THREE.Vector3(center.x - half, y, center.z)
      : new THREE.Vector3(center.x, y, center.z - half);
    const b = longX
      ? new THREE.Vector3(center.x + half, y, center.z)
      : new THREE.Vector3(center.x, y, center.z + half);
    out.push({
      id: `park-${out.length}`,
      a,
      b,
      kind: Math.min(size.x, size.z) <= 0.25 ? "rail" : "ledge",
      surface: "metal",
      radius: 0.35,
    });
    if (out.length >= MAX_PARK_RAILS) break;
  }
  return out;
}

const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();

/** Radius of the spawn pedestal in `cast()` — reset point plus slope taps. */
const SPAWN_R = 1.5;

/** Raycast ride surface for the streamed parks — exported for the headless walls check. */
export class ParkSurface implements SurfaceProvider {
  readonly softEdge = 55;
  private meshes: THREE.Object3D[] = [];
  private railsList: readonly GrindLine[] = [];
  private spawnPoint = { x: 0, z: 0, heading: 0 };
  /**
   * Top-of-middle-column ground the spawn stands on, once the geometry has
   * landed. Null until `dress` sets it (and for the analytic street — this
   * class never sees it).
   */
  private spawnGround: number | null = null;

  setMeshes(meshes: THREE.Object3D[]): void {
    this.meshes = meshes;
  }

  setRails(rails: readonly GrindLine[]): void {
    this.railsList = rails;
  }

  setSpawn(x: number, z: number, heading: number, groundY: number | null = null): void {
    this.spawnPoint = { x, z, heading };
    this.spawnGround = groundY;
  }

  /** Highest face at or below `yHint + STEP_UP`, else the slab (0). */
  private cast(x: number, z: number, yHint: number): { y: number; n: THREE.Vector3 } | null {
    if (this.meshes.length === 0) return null;
    // THE SPAWN PEDESTAL. Seating (`reset()`) asks height() with the default
    // yHint of 0, and the ledge discipline below would dive UNDER an elevated
    // spawn deck to the slab — the "below the map" report, verbatim. Within a
    // tight disc of the spawn (reset lands on the exact point; slope taps read
    // ±0.3 m) and at or below deck level, the answer is the deck. Deliberately
    // tight: a 1.5 m disc around a broad deck top cannot teleport a rider, and
    // anything airborne above reads the normal rule.
    if (this.spawnGround !== null) {
      const dx = x - this.spawnPoint.x;
      const dz = z - this.spawnPoint.z;
      if (dx * dx + dz * dz < SPAWN_R * SPAWN_R && yHint <= this.spawnGround + 1) {
        return { y: this.spawnGround, n: _up.clone() };
      }
    }
    _ray.set(new THREE.Vector3(x, yHint + 12, z), _down);
    _ray.far = 80;
    const hits = _ray.intersectObjects(this.meshes, false);
    for (const h of hits) {
      if (h.point.y <= yHint + 2.0) {
        const face = (h as { face?: { normal: THREE.Vector3 } | null }).face;
        if (face) _n.copy(face.normal).transformDirection(h.object.matrixWorld);
        else _n.set(0, 1, 0);
        return { y: h.point.y, n: _n.clone() };
      }
    }
    return null;
  }

  height(x: number, z: number, yHint = 0): number {
    return this.cast(x, z, yHint)?.y ?? 0;
  }

  normal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.cast(x, z, 0);
    if (c) return out.copy(c.n);
    return out.set(0, 1, 0);
  }

  sample(x: number, z: number, yHint = 0, out = makeSample()): SurfaceSample {
    const c = this.cast(x, z, yHint);
    out.height = c?.y ?? 0;
    if (c) out.normal.copy(c.n);
    else out.normal.set(0, 1, 0);
    const kind: SurfaceKind = "concrete";
    out.kind = kind;
    return out;
  }

  slopeAlong(x: number, z: number, dirX: number, dirZ: number, yHint = 0): number {
    const d = 0.3;
    const a = this.height(x + dirX * d, z + dirZ * d, yHint);
    const b = this.height(x - dirX * d, z - dirZ * d, yHint);
    return (a - b) / (2 * d);
  }

  rails(): readonly GrindLine[] {
    return this.railsList;
  }

  /**
   * Steep faces are walls. The ride probes AHEAD of the board in 5 cm pieces
   * (`WALL_STEP`), so the rule is asked of the point he is about to be, not
   * the one he is on: any face rising more than 0.3 m above the wheels inside
   * a 4 m window blocks — ledge sides, funbox walls, ramps stood on end.
   * Three things it deliberately does NOT catch, each measured, not assumed:
   *
   * · kerbs and stair toes (≤0.3 m over the probe) — he bumps over those, the
   *   way the street lets an 0.18 m kerb pass;
   * · transition faces he is riding UP — the top AT the probe is the face
   *   itself, within centimetres of the wheels, and anything steeper launches
   *   him before the walk ever reaches it (same as the street's lips);
   * · decks and roofs overhead (a face more than 4 m up, or facing DOWN like
   *   a ceiling) — he rides UNDER those, which is what the warehouse and the
   *   haunted house are for. A headless grid scan of sawmill found no cover
   *   above 3 m anywhere in the ride area, so the 4 m ceiling costs nothing
   *   there either.
   *
   * Motion INTO the face still decides what a block COSTS — `advanceStep`
   * keeps whatever was going along it, so catching a transition lip scrubs
   * and riding a wall head-on stops. See `tools/park-walls-check.mjs`, which
   * pins all four answers against synthetic geometry.
   */
  blocked(x: number, z: number, y: number): boolean {
    if (this.meshes.length === 0) return false;
    _ray.set(new THREE.Vector3(x, y + 12, z), _down);
    _ray.far = 80;
    const hits = _ray.intersectObjects(this.meshes, false);
    const n = new THREE.Vector3();
    for (const h of hits) {
      const rise = h.point.y - y;
      if (rise <= 0.3) continue;
      if (rise > 4.0) continue;
      const face = (h as { face?: { normal: THREE.Vector3 } | null }).face;
      if (face) {
        n.copy(face.normal).transformDirection(h.object.matrixWorld);
        if (n.y < -0.3) continue; // ceilings and undersides are ridden under
      }
      return true;
    }
    return false;
  }

  spawn(): { x: number; z: number; heading: number } {
    return { ...this.spawnPoint };
  }
}

interface ParkField extends Field {
  park: { surface: ParkSurface; group: THREE.Group; loaded: boolean };
}

function buildPark(def: ParkDef, scene: THREE.Scene, _tier: QualityTier): Field {
  const surface = new ParkSurface();
  const group = new THREE.Group();
  group.name = `park-${def.id}`;

  // The slab: fallback ground (height 0 where the ray finds nothing) and the
  // thing the first frame stands on while the GLB streams in.
  const slabGeo = new THREE.PlaneGeometry(260, 260);
  slabGeo.rotateX(-Math.PI / 2);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.95, metalness: 0 });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.receiveShadow = true;
  slab.name = "park-slab";
  group.add(slab);
  surface.setMeshes([slab]);

  // Light rig: warm key + cool shade, the street's own register, so a park
  // reads as the same evening. Static sun; `trackShadow` walks it with him.
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.2);
  const SUN_OFF = new THREE.Vector3(28, 38, 18);
  /** Last focus the cadence cache answered for — see `trackShadow` below. */
  let lastShadowFocus: THREE.Vector3 | null = null;
  sun.position.copy(SUN_OFF);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun);
  group.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x8fb0e0, 0xb08050, 0.55);
  group.add(hemi);
  scene.add(group);

  scene.fog = new THREE.Fog(0xd8a06a, 50, 230);
  scene.background = new THREE.Color(0x2a3040);

  const ground = slab;  // Street material/furniture/paint builders all need `document` (canvas
  // cards) and describe the street, not a park — so stubs with the right
  // shape. Nothing reads them: our dress never calls the street dress
  // passes, the loop only asks `surface`/`sun`/`trackShadow`, and the look
  // lab only touches the optional sun sliders (absent here on purpose).
  const materials = {} as Field["materials"];
  const furniture: Furniture = { group: new THREE.Group(), placeholders: new Set<PropKind>() };
  // No street paint in a park — and `buildPaint` needs `document`, so a stub
  // with the right shape (our dress never calls `dressPaint`, which is the
  // only reader of these arrays).
  const paint = { group: new THREE.Group(), materials: [], flat: [], drawn: [] } as unknown as Field["paint"];

  const field = {
    ground,
    sun,
    surface,
    materials,
    furniture,
    paint,
    shadowMapSize: 2048,
    trackShadow(focus: THREE.Vector3): boolean {
      sun.position.copy(focus).add(SUN_OFF);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
      // No draw-time snap on this rig, so approximate: moved unless the focus
      // is still within half a texel (90 m box over the live map size —
      // re-read every call, the governor halves it). Conservative by design:
      // a false "moved" only costs the raster it always paid.
      if (lastShadowFocus === null) {
        lastShadowFocus = focus.clone();
        return true;
      }
      const texel = 90 / Math.max(1, sun.shadow.mapSize.x);
      const moved = lastShadowFocus.distanceTo(focus) > texel / 2;
      if (moved) lastShadowFocus.copy(focus);
      return moved;
    },
    park: { surface, group, loaded: false },
  } satisfies ParkField;
  return field;
}

async function dressPark(
  def: ParkDef,
  scene: THREE.Scene,
  field: Field,
  tier: QualityTier,
  renderer: THREE.WebGLRenderer,
  _gltf?: GenexGltfLoader,
): Promise<void> {
  const park = (field as ParkField).park;
  // The street's own sky, through the rung ladder — background cube + PMREM
  // are disposed by `disposeSky` on the next spot change like any other map.
  try {
    const tex = await loadTextureWithFallback(CITY_SKYBOX_URL, tier, (u) =>
      new THREE.TextureLoader().loadAsync(u),
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    installPanoramaSky(scene, renderer, tex);
  } catch (e) {
    console.warn(`[park:${def.id}] sky failed — keeping flat colour`, e);
  }

  if (park.loaded) return;
  try {
    const url = `${import.meta.env.BASE_URL}parks/Skateparks/${def.file}`;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const inner = new THREE.Group();
    inner.name = "park-geometry";
    inner.add(...[...gltf.scene.children]);
    // Normalise: XZ extent to PARK_SPAN, min-Y onto the slab.
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1);
    const s = THREE.MathUtils.clamp(PARK_SPAN / span, 0.004, 2);
    inner.scale.setScalar(s);
    inner.position.x -= center.x * s;
    inner.position.z -= center.z * s;
    inner.position.y -= box.min.y * s;
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    park.group.add(inner);
    park.group.updateMatrixWorld(true);
    const parkMeshes: THREE.Object3D[] = [];
    inner.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) parkMeshes.push(o);
    });
    const slab = park.group.getObjectByName("park-slab");
    const all = slab ? [...parkMeshes, slab] : parkMeshes;
    park.surface.setMeshes(all);
    park.surface.setRails(deriveParkRails(parkMeshes));
    // Drop him in the middle, ON TOP of the middle (the player's instruction,
    // and the evidence backs it: the middle-column tops are broad decks —
    // warehouse ≈ 13.9 flat across ±12 m, haunted ≈ 15.3 — while the seating
    // rule dives under them to the slab). Middle column over void (no
    // geometry above the slab at all): open ground elsewhere instead.
    const mid = pickMiddleTop(parkMeshes);
    if (mid !== null) {
      park.surface.setSpawn(mid.x, mid.z, 0, mid.ground);
    } else {
      const open = pickParkSpawn(all);
      park.surface.setSpawn(open.x, open.z, open.heading, park.surface.height(open.x, open.z));
    }
    park.loaded = true;
  } catch (e) {
    console.warn(`[park:${def.id}] geometry failed — slab only`, e);
  }
}

function parkMap(def: ParkDef): GameMap {
  return {
    id: def.id as MapId,
    name: def.name,
    blurb: def.blurb,
    build: (scene, tier) => buildPark(def, scene, tier),
    dress: (scene, field, tier, renderer, gltf) => dressPark(def, scene, field, tier, renderer, gltf),
  };
}

export const PARK_MAPS: GameMap[] = PARKS.map(parkMap);
