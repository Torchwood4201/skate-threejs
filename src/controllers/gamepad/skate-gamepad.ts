// The controller's hands — THE FEEDER, and deliberately nothing else.
//
// A gamepad is read, not listened to: `navigator.getGamepads()` is polled
// once per frame, before `consume()`. So this module owns no listeners, no
// DOM and no chunk split — one `poll()` call in the main loop is the whole
// wiring, and a machine with no pad pays one falsy array read per frame.
//
// It feeds `SkateInputSource` through the SAME three doors the thumbs use
// (`touchControl` / `touchSteer` / `flickTrick`), so every argument settled
// there applies unchanged: the push/pop tie-break, the staleness gate, the
// edge latches. A pad that produced a different kickflip than F would be a
// second game — the parity checks in `tools/input-matrix.mjs` (item 10) are
// what stops that.
//
// ── THE MAP — the PDF's Flick-it layout, and nothing else ──────────────────
// The player handed over the Rust engine's control PDF and asked for ONLY
// those controls. So this is that scheme, re-implemented against the verbs
// this game actually has:
//
//   left stick X   steer / carve — the same +1-is-screen-right `touchSteer`
//                    the thumb stick writes, through the same smoothing ramp.
//                    Left-stick Y does NOTHING: push is A and brake is B in
//                    the PDF, and a second throttle on the stick would be a
//                    second game, not an alias.
//   A (0) hold      push — KeyW while held, so holding A keeps kicking like
//                    holding W does.
//   B (1) hold      brake / powerslide — KeyS while held, with steer.
//   X (2) tap       step off / get back on — there is no off-board mode, so
//                    the honest stand-in is reset (KeyR tap): off the line
//                    and back at the spawn.
//   Y (3) hold      nollie — there is no nose-pop, so the stand-in is the
//                    ollie itself: Space held, release pops.
//   LB (4) hold     square-entry modifier — KeyE while held.
//   RB (5) hold     manual — ShiftLeft while held. The PDF's manuals are
//                    right-stick holds, but the stick is busy being the board
//                    (crouch + flicks); the bumper keeps the verb reachable.
//                    Nose manual has no pad path — recorded open, not silent.
//   LT (6) hold     left-hand grab — KeyX while held.
//   RT (7) hold     right-hand grab — KeyX while held. Which grab it IS comes
//                    off the left stick's direction, the way the PDF's grab
//                    table reads (LT vs RT + direction); the flavour names are
//                    the ride's (`pickGrab`), not a second table here.
//   right stick     THE BOARD. Pull down past 0.6 and he crouches (Space
//                    down); let go and the pop fires. Flick up and he ollies.
//                    Flick up-LEFT and he kickflips, up-RIGHT and he heelflips
//                    (the PDF's diagonals, regular stance), left/right the
//                    same two, down-diagonals shove-it. A down-then-diagonal
//                    in ONE motion crouches first and spends the pop into the
//                    flip — exactly the PDF's "pull down, then flick" —
//                    because `flickTrick` runs the model's own
//                    flicked-spends-wind-up rule.
//   R3 (11) tap     bail — no forced-bail verb exists, so like X this is
//                    reset: off the board and back at the spawn.
//   Back (8) tap    reset — same latch R sets.
//   Start (9) tap   pause, through `pressPause` — the boot owns the pause key
//                    (Escape), so this raises a latch the loop polls, exactly
//                    like `takeReset`.
//   d-pad           nothing — it is not in the PDF, so it drives nothing.
//   slow motion (LT in the PDF's basics table) and object manipulation (RT)
//                    have no game verb and are not mapped; the triggers grab.
//
// The mash-up's newer keys have no pad path and are recorded open, not
// silent: tre flip (I), grind-commit (G) and revert (V) are keyboard-only,
// and so is the nose manual (Shift+M / Q). Everything the spec's own pad
// line asks for — left-stick move, right-stick flicks, A push, B brake,
// LT grab — was already here and is unchanged.
//
// ── WHAT IT NEVER TOUCHES ─────────────────────────────────────────────────
// The camera. The right stick is the trick stick here (the PDF's own split),
// so the mouse keeps the view with nothing to fight. Disconnects DROP only
// the codes the pad itself is holding — silently, so a yanked plug mid-wind-up
// stands him up instead of popping him — never `releaseAll()`, which would eat
// a keyboard hold whose key is still physically down and (repeat is ignored)
// would never come back.

import type { FlickCode, TouchControlCode } from "../../ui/touch-controls";
import type { SkateInputSource } from "../../skate/input";

/** The slice of `Gamepad` this feeder reads — structural, so the harness can
 *  drive scripted pads without a browser. */
export interface PadState {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

export type PadProvider = () => readonly (PadState | null)[];

function browserPads(): readonly (PadState | null)[] {
  try {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return [];
    return navigator.getGamepads();
  } catch {
    return [];
  }
}

/** Under this the stick is a resting thumb, not an ask. Same 0.12 as the
 *  thumb stick's own dead zone (`skate-touch-layer.ts`). */
const STICK_DEADZONE = 0.12;
/** A flick throws past this deflection… */
const FLICK_THROW = 0.6;
/** …and the stick must come back inside this before it may throw again. */
const FLICK_REARM = 0.35;

/**
 * Holds while down: A push, B brake, Y nollie(=ollie), LB slide, RB manual,
 * LT/RT grab. X is NOT here — it taps reset (see below).
 */
const HOLD_CODES: Record<number, TouchControlCode> = {
  0: "KeyW", // A — push
  1: "KeyS", // B — brake / powerslide
  3: "Space", // Y — nollie stand-in: the ollie itself
  4: "KeyE", // LB — square-entry modifier
  5: "ShiftLeft", // RB — manual
  6: "KeyX", // LT — left-hand grab
  7: "KeyX", // RT — right-hand grab
};

export class SkateGamepad {
  private readonly input: SkateInputSource;
  private readonly pads: PadProvider;
  private readonly buttonsDown = new Map<number, boolean>();
  private flickArmed = true;
  /** The right stick is holding his crouch (Space down through the stick). */
  private rsCrouch = false;
  /** A flip already left this crouch — one throw per pull-down. */
  private rsFlicked = false;
  private wasConnected = false;

  constructor(input: SkateInputSource, pads: PadProvider = browserPads) {
    this.input = input;
    this.pads = pads;
  }

  /** One poll per frame, before `takeReset()`/`consume()`. */
  poll(): void {
    const list = this.pads();
    let pad: PadState | null = null;
    for (const p of list) {
      if (p) {
        pad = p;
        break;
      }
    }
    // First non-null pad wins; a second pad on the couch is furniture.
    if (!pad) {
      if (this.wasConnected) this.letGo();
      return;
    }
    this.wasConnected = true;

    const ax = (i: number): number => {
      const v = pad.axes[i];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    const pressed = (i: number): boolean => pad.buttons[i]?.pressed === true;

    // --- left stick X: carve -------------------------------------------------
    // Radial dead zone, rescaled so full deflection is still exactly 1 — the
    // thumb stick's own formula, so one ramp serves every hand. Y is
    // deliberately unread: push is A, brake is B.
    const lx = ax(0);
    const ly = ax(1);
    const mag = Math.hypot(lx, ly);
    let steer = 0;
    if (mag > STICK_DEADZONE) {
      const k = (mag - STICK_DEADZONE) / ((1 - STICK_DEADZONE) * mag);
      steer = Math.max(-1, Math.min(1, lx * k));
    }
    // No sign change: stick-right IS D IS screen-right (traced in the layer).
    this.input.touchSteer(steer);

    // --- right stick: the board ----------------------------------------------
    const rx = ax(2);
    const ry = ax(3);
    const rmag = Math.hypot(rx, ry);
    if (rmag < FLICK_REARM) {
      // Home. A crouch held through the stick ends here — Space up, which is
      // the pop if anything was wound, exactly like letting go of the key.
      if (this.rsCrouch) {
        this.rsCrouch = false;
        this.input.touchControl("Space", false);
      }
      this.rsFlicked = false;
      this.flickArmed = true;
    } else if (this.flickArmed && rmag > FLICK_THROW) {
      this.flickArmed = false;
      this.throwSector(rx, ry, false);
    } else if (this.rsCrouch && !this.rsFlicked && rmag > FLICK_THROW) {
      // The PDF's "pull down, THEN flick": the throw left the crouch without
      // coming home first, so it spends the pop into the flip through the
      // model's own flicked-spends-wind-up rule. A down-sector reading throws
      // nothing (still crouching), so the throw is NOT spent — the flick is
      // still coming.
      if (this.throwSector(rx, ry, true)) this.rsFlicked = true;
    }

    // --- buttons: edges only -------------------------------------------------
    // Only on CHANGE: holding a button must not re-press it every frame, and a
    // press while nothing reads the source is dropped by the same `live()`
    // gate a key meets (see `touchControl`). The first sighting of a button
    // is learnt SILENTLY: two buttons share KeyX (LT and RT both grab), and
    // announcing 7's initial "up" would release 6's just-pressed hold.
    for (const [index, code] of Object.entries(HOLD_CODES)) {
      const i = Number(index);
      const isDown = pressed(i);
      const prev = this.buttonsDown.get(i);
      if (prev === undefined) {
        this.buttonsDown.set(i, isDown);
        if (isDown) this.input.touchControl(code, true);
        continue;
      }
      if (isDown === prev) continue;
      this.buttonsDown.set(i, isDown);
      // LT and RT share KeyX: letting go of one while the other is still
      // down must not drop the grab out from under the held trigger.
      if (!isDown && (i === 6 || i === 7)) {
        const sib = i === 6 ? 7 : 6;
        if (pressed(sib)) continue;
      }
      this.input.touchControl(code, isDown);
    }
    // X = step off / get back on: pressed and released in one poll, which is
    // the same latch R sets.
    if (this.edge(2, pressed(2))) {
      this.input.touchControl("KeyR", true);
      this.input.touchControl("KeyR", false);
    }
    // R3 = bail: the same stand-in, for the same reason (no forced-bail verb).
    if (this.edge(11, pressed(11))) {
      this.input.touchControl("KeyR", true);
      this.input.touchControl("KeyR", false);
    }
    // Back = reset: pressed and released in one poll, like the touch RESET.
    if (this.edge(8, pressed(8))) {
      this.input.touchControl("KeyR", true);
      this.input.touchControl("KeyR", false);
    }
    // Start = pause, through the boot's own door (see `takePausePressed`).
    if (this.edge(9, pressed(9))) this.input.pressPause();
  }

  /**
   * Which trick a right-stick deflection means, by angle. Up is 90° (the
   * stick's Y grows down, so it is negated once, here and nowhere else).
   * Left throws kickflip and right throws heelflip — the PDF's diagonals for
   * a regular stance — and pure left/right throw the same two, so a flick
   * and its diagonal never disagree about which foot it is.
   *
   * Returns whether a trick left the stick: the down sector from inside a
   * crouch throws nothing (still crouching), and the caller keeps the throw
   * armed for the flick that is still coming.
   */
  private throwSector(rx: number, ry: number, fromCrouch: boolean): boolean {
    const deg = (Math.atan2(-ry, rx) * 180) / Math.PI;
    const norm = deg < 0 ? deg + 360 : deg;
    if (norm >= 67.5 && norm < 112.5) {
      // Up: the ollie. From a crouch that is the pop (Space up); from neutral
      // it is a tap (press + release in one gesture, the instant ollie).
      if (fromCrouch && this.rsCrouch) {
        this.rsCrouch = false;
        this.input.touchControl("Space", false);
      } else {
        this.input.flickTrick("Space");
      }
      return true;
    }
    if (norm >= 247.5 && norm < 292.5) {
      // Pure down: the crouch. Anything else down-ish is the circular half of
      // a shove-it.
      if (!fromCrouch && !this.rsCrouch) {
        this.rsCrouch = true;
        this.input.touchControl("Space", true);
      }
      return false;
    }
    // Down half (the circular path a shove-it takes) throws shove-it;
    // everything else sideways throws its own foot's flip.
    let code: FlickCode;
    if (norm >= 202.5 && norm < 247.5) code = "KeyC";
    else if (norm >= 292.5 && norm < 337.5) code = "KeyC";
    else if (norm >= 112.5 && norm < 202.5) code = "KeyF";
    else if (norm >= 337.5 || norm < 22.5) code = "KeyG";
    else code = "KeyG";
    this.input.flickTrick(code);
    return true;
  }

  private edge(index: number, isDown: boolean): boolean {
    const was = this.buttonsDown.get(index) === true;
    this.buttonsDown.set(index, isDown);
    return isDown && !was;
  }

  /**
   * Forget edge memory, called on unpause. A press that starts while paused
   * is dropped by the staleness gate, so the map would otherwise believe a
   * still-held button never changes again. Releases nothing: what the source
   * holds is the truth, and the next poll re-asserts the edges.
   */
  resync(): void {
    this.buttonsDown.clear();
    this.flickArmed = true;
    this.rsCrouch = false;
    this.rsFlicked = false;
  }

  /** The pad left: drop only what it was holding, then forget the edges. */
  private letGo(): void {
    this.wasConnected = false;
    this.input.touchSteer(0);
    // Dropped, not released: `release()` on a held Space would POP him, and
    // a yanked plug mid-wind-up stands him up instead — the pad's answer to
    // the window-blur path (`releaseAll`), per code rather than whole. The
    // stick's crouch is Space too, so it goes through the same door.
    if (this.rsCrouch) {
      this.rsCrouch = false;
      this.input.dropControl("Space");
    }
    for (const [index, code] of Object.entries(HOLD_CODES)) {
      if (this.buttonsDown.get(Number(index))) {
        this.buttonsDown.set(Number(index), false);
        // Space (Y) drops silently; everything else is a level, and dropping
        // a level reads the same as releasing it with nobody watching.
        if (code === "Space") this.input.dropControl(code);
        else this.input.touchControl(code, false);
      }
    }
    this.buttonsDown.clear();
    this.flickArmed = true;
    this.rsFlicked = false;
  }
}
