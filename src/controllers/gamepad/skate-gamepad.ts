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
// ── THE MAP (standard layout, Xbox-shaped) ─────────────────────────────────
//   left stick X    carve — the same +1-is-screen-right `touchSteer` the thumb
//                   stick writes, through the same smoothing ramp, so a stick
//                   at deflection d is byte-identical to a key held at d.
//   left stick Y    push (up) / brake (down) through the SAME 0.45/0.30
//                   hysteresis gate the thumb stick uses — a bare threshold
//                   chatters, and every chatter is a fresh push edge that spends
//                   a wind-up (see the gate's own note in `skate/input.ts`).
//   right stick     FLICK — thrown once per excursion past 0.6 after re-arming
//                   below 0.35, resolved through `flickTrick`: up pops, right
//                   kicks, left heels, down shoves. The arm/disarm is what stops
//                   a held deflection machine-gunning kickflips.
//   A               Space — hold loads the crouch, release pops, like OLLIE.
//   X / Y / B       KeyF / KeyG / KeyC — the three flip latches.
//   RT / LT         KeyX (grab) / ShiftLeft (manual) — the two holds.
//   LB / RB         KeyE (slide-across) / KeyQ (nose manual).
//   d-pad           up/down push/brake, left/right digital carve at ±1.
//   Start           pause, through `pressPause` — the boot owns the pause key
//                   (Escape), so this raises a latch the loop polls, exactly
//                   like `takeReset`.
//   Back            reset — pressed and released in one poll, like the touch
//                   RESET, which is the same latch R sets.
//
// ── WHAT IT NEVER TOUCHES ─────────────────────────────────────────────────
// The camera. The right stick is the trick stick here (Skate 3's own split),
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
/** Push/brake engage/release on the left stick's y — the thumb's own gate. */
const AXIS_ENGAGE = 0.45;
const AXIS_RELEASE = 0.3;
/** A flick throws past this deflection… */
const FLICK_THROW = 0.6;
/** …and the stick must come back inside this before it may throw again. */
const FLICK_REARM = 0.35;

const BUTTON_CODES: Record<number, TouchControlCode> = {
  0: "Space", // A — hold to load, release to pop
  1: "KeyC", // B — shove-it
  2: "KeyF", // X — kickflip
  3: "KeyG", // Y — heelflip
  4: "KeyE", // LB — slide-across
  5: "KeyQ", // RB — nose manual
  6: "ShiftLeft", // LT — manual
  7: "KeyX", // RT — grab
};

export class SkateGamepad {
  private readonly input: SkateInputSource;
  private readonly pads: PadProvider;
  private readonly axisDown = { KeyW: false, KeyS: false };
  private readonly buttonsDown = new Map<number, boolean>();
  private flickArmed = true;
  private wasConnected = false;

  constructor(input: SkateInputSource, pads: PadProvider = browserPads) {
    this.input = input;
    this.pads = pads;
  }

  /** One poll per frame, before `takeReset()`/`consume()`. */
  poll(): void {    const list = this.pads();
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

    // --- left stick: carve + push/brake ------------------------------------
    // Radial dead zone, rescaled so full deflection is still exactly 1 — the
    // thumb stick's own formula, so one ramp serves both hands.
    const lx = ax(0);
    const ly = ax(1);
    const mag = Math.hypot(lx, ly);
    let steer = 0;
    let up = 0;
    let down = 0;
    if (mag > STICK_DEADZONE) {
      const k = (mag - STICK_DEADZONE) / ((1 - STICK_DEADZONE) * mag);
      steer = Math.max(-1, Math.min(1, lx * k));
      up = Math.max(0, Math.min(1, -ly * k));
      down = Math.max(0, Math.min(1, ly * k));
    }
    // d-pad left/right are digital carve at ±1 when the stick is silent.
    if (steer === 0) {
      if (pressed(14)) steer = -1;
      else if (pressed(15)) steer = 1;
    }
    // No sign change: stick-right IS D IS screen-right (traced in the layer).
    this.input.touchSteer(steer);
    // d-pad up/down join the analogue push/brake through the same gate.
    this.gate("KeyW", pressed(12) ? 1 : up);
    this.gate("KeyS", pressed(13) ? 1 : down);

    // --- right stick: the flick ---------------------------------------------
    const rx = ax(2);
    const ry = ax(3);
    const rmag = Math.hypot(rx, ry);
    if (this.flickArmed && rmag > FLICK_THROW) {
      this.flickArmed = false;
      const code: FlickCode =
        Math.abs(rx) >= Math.abs(ry) ? (rx > 0 ? "KeyF" : "KeyG") : ry > 0 ? "KeyC" : "Space";
      this.input.flickTrick(code);
    } else if (!this.flickArmed && rmag < FLICK_REARM) {
      this.flickArmed = true;
    }

    // --- buttons: edges only -------------------------------------------------
    // Only on CHANGE: holding a button must not re-press it every frame, and a
    // press while nothing reads the source is dropped by the same `live()`
    // gate a key meets (see `touchControl`).
    for (const [index, code] of Object.entries(BUTTON_CODES)) {
      const i = Number(index);
      const isDown = pressed(i);
      if (isDown === this.buttonsDown.get(i)) continue;
      this.buttonsDown.set(i, isDown);
      this.input.touchControl(code, isDown);
    }
    // Back = reset: pressed and released in one poll, like the touch RESET.
    if (this.edge(8, pressed(8))) {
      this.input.touchControl("KeyR", true);
      this.input.touchControl("KeyR", false);
    }
    // Start = pause, through the boot's own door (see `takePausePressed`).
    if (this.edge(9, pressed(9))) this.input.pressPause();
  }

  private gate(code: "KeyW" | "KeyS", value: number): void {
    const open = this.axisDown[code] ? value > AXIS_RELEASE : value > AXIS_ENGAGE;
    if (open === this.axisDown[code]) return;
    this.axisDown[code] = open;
    this.input.touchControl(code, open);
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
  }

  /** The pad left: drop only what it was holding, then forget the edges. */
  private letGo(): void {
    this.wasConnected = false;
    this.input.touchSteer(0);
    for (const code of ["KeyW", "KeyS"] as const) {
      if (this.axisDown[code]) {
        this.axisDown[code] = false;
        this.input.dropControl(code);
      }
    }
    // Dropped, not released: `release()` on a held Space would POP him, and
    // a yanked plug mid-wind-up stands him up instead — the pad's answer to
    // the window-blur path (`releaseAll`), per code rather than whole.
    for (const [index, code] of Object.entries(BUTTON_CODES)) {
      if (this.buttonsDown.get(Number(index))) {
        this.buttonsDown.set(Number(index), false);
        this.input.dropControl(code);
      }
    }
    this.buttonsDown.clear();
    this.flickArmed = true;
  }
}
