// THE INPUT MATRIX — every order and every release of the keys that argue.
//
// Two of this round's asks are about which key wins when two are down, and
// neither can be checked by pressing them once: the answer depends on which
// arrived SECOND and on which comes up first afterwards, so the only honest
// test is the whole matrix, driven through the REAL `SkateInputSource` with
// real key events and read off the REAL `SkateModel`.
//
//   · **push vs the pop** (`SkateInput.chargeHeld` / `olliePressed`). The
//     player: press W and hold Space and, while W is still down, the push must
//     not fire again — Space wins; but hold Space FIRST and then press push and
//     the jump is called off. Two rules about the same two keys, decided by
//     which one arrived second.
//   · **the slide key** (`SkateInput.slideHeld`), and this half has now been the
//     player's ask in BOTH directions, which is why the checks read the way they
//     do. Milestone 12: *"a separate button to turn sliding on, so he doesn't
//     automatically go along rails — it's my choice, on a button."* Then, having
//     ridden it: *"let's make rail sliding activate when I simply ride onto it,
//     without holding a button. As soon as you ride onto it, the rail slide
//     starts."* So the same 36 approaches that used to prove no rail takes him
//     without the key now prove every rail takes him without it, the key is
//     measured for NOT changing that, and what E still buys is the one entry
//     riding onto a line cannot ask for — the deck square across it. Every rule
//     the catch already had has to still be there either way, which is the block
//     at the bottom.
//
// Run: node --experimental-strip-types tools/input-matrix.mjs
//
// Every case here runs at 30, 60 and 144 fps, because both of these are EDGE
// rules — "the frame the key went down" — and an edge read at three frame rates
// is the cheapest way to catch one that has quietly become a level.

import { register } from "node:module";
import * as THREE from "three";

register(new URL("./ts-resolve.mjs", import.meta.url));
// …and directory specifiers on top of it, because `ts-resolve.mjs` only tries
// `<spec>.ts`: `spot.ts` imports `./procedural`, which is `./procedural/index.ts`,
// and without this every harness in this repo stops at the import. Registered
// as a SECOND hook rather than by editing the shared resolver, which is another
// lane's file — hooks chain, the most recent runs first, and this one falls
// straight through to `ts-resolve` for everything it does not recognise.
register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function resolve(spec, ctx, next) {
  if (spec.startsWith(".") && path.extname(spec) === "" && ctx.parentURL) {
    const base = path.dirname(fileURLToPath(ctx.parentURL));
    const index = path.resolve(base, spec, "index.ts");
    if (existsSync(index)) return next(pathToFileURL(index).href, ctx);
  }
  return next(spec, ctx);
}
`),
);

const { SkateModel, EMPTY_INPUT } = await import("../src/skate/skate-model.ts");
const { SkateInputSource } = await import("../src/skate/input.ts");
const { STREET_SPOT, RAILS } = await import("../src/world/spot.ts");

const RATES = [30, 60, 144];

const results = [];
const check = (name, pass, detail, proof) => {
  results.push({ name, pass, detail, proof: proof ?? null });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}` +
      (proof ? "" : "   [UNPROVEN — never watched failing]"),
  );
};

/**
 * A pair of hands on a real keyboard, feeding the real input source — the same
 * idiom `tools/integration-check.mjs` uses, and for the same reason: an input
 * object written by hand can hold a combination no hand can produce, and this
 * whole file is about combinations hands produce.
 */
function hands(dt) {
  const listeners = {};
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  globalThis.window = {
    addEventListener: (t, f) => void (listeners[t] ??= []).push(f),
    removeEventListener: () => {},
  };
  const src = new SkateInputSource();
  src.attach();
  if (saved) Object.defineProperty(globalThis, "window", saved);
  else delete globalThis.window;
  src.consume(dt); // the loop was already running when the hands arrived

  const down = new Set();
  const fire = (type, code) =>
    listeners[type]?.forEach((f) => f({ code, repeat: false, preventDefault() {} }));
  return (hold) => {
    const want = new Set(hold);
    for (const code of [...down])
      if (!want.has(code)) {
        fire("keyup", code);
        down.delete(code);
      }
    for (const code of want)
      if (!down.has(code)) {
        fire("keydown", code);
        down.add(code);
      }
    return src.consume(dt);
  };
}

/**
 * Roll along the flat plaza on the south terrace holding a scripted key
 * pattern, and report what the ride was told.
 *
 * `script(i, t)` returns the codes down on frame `i`. The terrace is chosen
 * because it is the one large piece of dead-flat ground in the spot with
 * nothing on it — a case about two keys must not be able to fail on a kerb.
 */
function drive(fps, seconds, script) {
  const dt = 1 / fps;
  const keys = hands(dt);
  const pushes = [];
  let pops = 0;
  const model = new SkateModel(
    {
      onPush: () => pushes.push(model.position.clone()),
      onPop: () => pops++,
    },
    STREET_SPOT,
  );
  model.position.set(-18, STREET_SPOT.height(-18, -24), -24);
  model.heading = Math.PI / 2;
  const n = Math.round(seconds / dt);
  const charge = [];
  for (let i = 0; i < n; i++) {
    const input = keys(script(i, i * dt));
    charge.push(input.chargeHeld);
    model.update(input, dt);
  }
  return { pushes: pushes.length, pops, speed: model.speed, charging: charge.filter(Boolean).length };
}

/** A script from a list of `[seconds, codes]` spans — easier to read than frames. */
const spans = (list) => (_i, t) => {
  for (const [until, codes] of list) if (t < until) return codes;
  return [];
};

console.log("--- item 8: the push and the pop, both orders, both releases ---\n");

// PUSH_INTERVAL is 0.85 s, so three seconds of an unopposed throttle is three
// or four kicks. Anything that suppresses the repeat shows up as ONE.
{
  const plain = RATES.map((fps) => drive(fps, 3, spans([[3, ["KeyW"]]])));
  check(
    "W on its own keeps kicking",
    plain.every((r) => r.pushes >= 3 && r.pops === 0),
    RATES.map((fps, i) => `${fps}fps ${plain[i].pushes} kicks, ${plain[i].speed.toFixed(1)} m/s`).join(" · "),
    "src/skate/input.ts — latch `pushLocked` on `pushStarted` instead of on Space going down — 0 kicks and 0.0 m/s at every rate: the push key locks itself out",
  );

  // ORDER A — the push is already down and Space arrives on top of it.
  // Space wins: the wind-up survives all the way to the pop, and the kicks stop
  // until the push key comes up.
  const a = RATES.map((fps) =>
    drive(fps, 3, spans([
      [0.2, ["KeyW"]],
      [2.6, ["KeyW", "Space"]],
      [3, ["KeyW"]],
    ])),
  );
  check(
    "W first, then Space: the pop survives",
    a.every((r) => r.pops === 1),
    RATES.map((fps, i) => `${fps}fps ${a[i].pops} pop`).join(" · "),
    "src/skate/input.ts — spend the wind-up whenever the push key is merely DOWN (`(pushDown || flicked) && winding`, the pre-round-5 bug) — 0 pops at every rate",
  );
  check(
    "…and the push holds off while SPACE is down, then comes back when it is up",
    // TWO kicks, and which two is the whole rule. One in the 0.2 s before Space
    // arrived. Then nothing for the 2.4 s Space is held — an unopposed W would
    // have paid out seven intervals in there — and one more in the 0.4 s after
    // Space comes up at 2.6 s.
    //
    // This assertion used to read `pushes === 1`: no kick for the rest of the
    // run, full stop. That was the bug the player reported on 2026-07-29 —
    // "when I'm riding and press push, then jump, without releasing W, after I
    // land the character stops moving and doesn't keep pushing". The latch was
    // waiting on a key he was never going to let go of. The rule is a tie-break
    // between two keys held AT ONCE, so it ends when they are not both held.
    a.every((r) => r.pushes === 2),
    RATES.map((fps, i) => `${fps}fps ${a[i].pushes} kicks in 3 s — one before Space, one after it came up (an unopposed W gives ${plain[i].pushes})`).join(" · "),
    "src/skate/input.ts — end `pushLocked` only on the PUSH key coming up — 1 kick at every rate: the push never returns, which is the reported bug",
  );

  // …and the OTHER release: let W up first, with Space still held. The lock is
  // held until the push key comes up, which is the player's own wording, so
  // this is the case that says when it ends.
  const aRelease = RATES.map((fps) =>
    drive(fps, 3, spans([
      [0.2, ["KeyW"]],
      [1.0, ["KeyW", "Space"]],
      [1.1, ["Space"]],
      [2.8, ["KeyW", "Space"]],
      [3, ["KeyW"]],
    ])),
  );
  check(
    "…and letting W up is what ends the lock — pressing it again kicks",
    // The second W press is a `pushStarted` with Space already held, which is
    // rule (b): it spends the wind-up. So this case kicks AND loses the pop,
    // and that is the whole point of the pair.
    aRelease.every((r) => r.pushes >= 2 && r.pops === 0),
    RATES.map((fps, i) => `${fps}fps ${aRelease[i].pushes} kicks, ${aRelease[i].pops} pops`).join(" · "),
    "src/skate/input.ts — stop spending the wind-up on a push (`if (flicked && windingWas)`) — 1 pop at every rate out of a crouch the second W press had already called off",
  );

  // ORDER B — Space is already down and the push arrives on top of IT. The
  // player's older rule, unchanged: you cannot kick and pop off the same foot,
  // and reaching for speed mid-crouch means the speed.
  const b = RATES.map((fps) =>
    drive(fps, 3, spans([
      [0.2, ["Space"]],
      [2.6, ["Space", "KeyW"]],
      [3, ["KeyW"]],
    ])),
  );
  check(
    "Space first, then W: the jump is called off",
    b.every((r) => r.pops === 0),
    RATES.map((fps, i) => `${fps}fps ${b[i].pops} pops, ${b[i].pushes} kicks, ${b[i].speed.toFixed(1)} m/s`).join(" · "),
    "src/skate/input.ts — stop spending the wind-up on a push (`if (flicked && windingWas)`) — 1 pop at every rate off a crouch the player had already abandoned",
  );
  check(
    "…and it is the PUSH he gets instead",
    b.every((r) => r.pushes >= 2 && r.speed > 4),
    RATES.map((fps, i) => `${fps}fps ${b[i].pushes} kicks → ${b[i].speed.toFixed(1)} m/s`).join(" · "),
    "src/skate/input.ts — read both rules against the keys as they are NOW (`winding && pushDown`) — 0 kicks and 0.0 m/s: the crouch he is standing in locks the key he just reached for",
  );
  // …and the other release for that order too: Space up first, W still down.
  const bRelease = RATES.map((fps) =>
    drive(fps, 3, spans([
      [0.2, ["Space"]],
      [1.0, ["Space", "KeyW"]],
      [3, ["KeyW"]],
    ])),
  );
  check(
    "…and letting Space up first still pops nothing",
    bRelease.every((r) => r.pops === 0 && r.pushes >= 2),
    RATES.map((fps, i) => `${fps}fps ${bRelease[i].pops} pops, ${bRelease[i].pushes} kicks`).join(" · "),
    "src/skate/input.ts — stop spending the wind-up on a push — 1 pop at every rate",
  );

  // BOTH IN ONE FRAME is neither order, and it is left alone: nothing arrived
  // second, so he pushes and he can still pop. Without this the two rules meet
  // in the middle and whichever line runs first silently wins.
  const together = RATES.map((fps) =>
    drive(fps, 3, spans([
      [2.6, ["KeyW", "Space"]],
      [3, []],
    ])),
  );
  check(
    "both keys down on ONE frame is neither rule",
    together.every((r) => r.pops === 1 && r.pushes >= 2),
    RATES.map((fps, i) => `${fps}fps ${together[i].pushes} kicks and ${together[i].pops} pop`).join(" · "),
    "src/skate/input.ts — read both rules against the keys as they are NOW (`winding` / `winding && pushDown`) — 0 kicks and 0 pops at every rate: the two rules fire on each other",
  );

  const alone = RATES.map((fps) => drive(fps, 1.5, spans([[1.2, ["Space"]], [1.5, []]])));
  check(
    "Space on its own still pops",
    alone.every((r) => r.pops === 1 && r.charging > 0),
    RATES.map((fps, i) => `${fps}fps ${alone[i].pops} pop after ${alone[i].charging} frames of wind-up`).join(" · "),
    "src/skate/input.ts — spend the wind-up on the crouch itself (`if (winding) chargeSpent = true`) — 0 pops after 0 frames of wind-up at every rate",
  );
}

console.log("\n--- item 12: the slide key ---\n");

// The approach every case here uses: line up on a rail, ollie at it, and see
// what the ride does. Copied from `integration-check`'s own rail recipe rather
// than invented, so a catch that works there works here.
//
// `opts.across` swings the whole approach 90° round, which is the one entry the
// key still owns — see the block below and `SkateModel.tryCatchGrind`. Aimed at
// the MIDDLE of the line rather than its head, because a square approach to a
// head misses the line by however far back the run-up started.
function atRail(id, v, fps, hold, opts = {}) {
  const dt = 1 / fps;
  const line = RAILS.find((r) => r.id === id);
  const keys = hands(dt);
  const events = [];
  const model = new SkateModel(
    {
      onGrindStart: (kind) => events.push(`grind:${kind}`),
      onGrindEnd: (bailed) => events.push(bailed ? "grind-lost" : "grind-out"),
      onBail: () => events.push("bail"),
    },
    STREET_SPOT,
  );
  const axis = Math.atan2(line.b.x - line.a.x, line.b.z - line.a.z);
  const heading = opts.across ? axis + Math.PI / 2 : axis;
  const back = opts.lead ?? 1.6;
  const from = opts.across ? line.a.clone().lerp(line.b, 0.4) : line.a;
  const x = from.x - Math.sin(heading) * back;
  const z = from.z - Math.cos(heading) * back;
  model.position.set(x, STREET_SPOT.height(x, z), z);
  model.heading = heading;
  model.speed = v;
  const n = Math.round((opts.seconds ?? 1.6) / dt);
  let onLine = 0;
  for (let i = 0; i < n; i++) {
    model.update(keys(hold(i, i * dt)), dt);
    if (model.state === "grind") onLine++;
  }
  return { events, onLine, state: model.state, speed: model.speed };
}

/** Space down for two frames then up — the only ollie a player can make. */
const popThen = (extra) => (i) => (i < 2 ? ["Space", ...extra] : [...extra]);

{
  const speeds = [6, 8, 10, 12];
  const lines = ["flat-bar", "handrail-6", "ledge-long-e"];
  const tally = (extra) => {
    let caught = 0;
    let total = 0;
    let bails = 0;
    for (const fps of RATES)
      for (const id of lines)
        for (const v of speeds) {
          const r = atRail(id, v, fps, popThen(extra));
          total++;
          if (r.events.some((e) => e.startsWith("grind:"))) caught++;
          if (r.events.includes("bail")) bails++;
        }
    return { caught, total, bails };
  };
  const off = tally([]);
  const on = tally(["KeyE"]);
  // THE CONTRACT TURNED OVER ON 2026-07-30, and these two checks turned with it.
  // They read "no rail and no ledge takes him without the slide key" and "…and
  // holding Shift is what takes him" — the milestone-12 rule, and the player has
  // since asked for its opposite in his own words: *"let's make rail sliding
  // activate when I simply ride onto it, without holding a button. As soon as you
  // ride onto it, the rail slide starts."* So the same 36 approaches are measured
  // the other way up, and the second one is now the stronger statement of the
  // two: the key is not a gate at all, so holding it must not change the number.
  check(
    "every rail and every ledge takes him with NOTHING held",
    off.caught === off.total && off.bails === 0,
    `${off.caught}/${off.total} approaches locked on with nothing held, ${off.bails} of them ending on the concrete — three lines, 6/8/10/12 m/s, 30/60/144 fps`,
    "src/skate/skate-model.ts `tryCatchGrind` — the milestone-12 gate put back " +
      "(`if (!this.slideWanted) return false`) — 0/36 lock on",
  );
  check(
    "…and E is not a gate any more — holding it changes nothing about that",
    on.caught === off.caught,
    `${on.caught}/${on.total} with E held against ${off.caught}/${off.total} with nothing`,
    "src/skate/skate-model.ts `tryCatchGrind` — the milestone-12 gate put back — 36/36 held " +
      "against 0/36 with nothing, which is the whole of the player's complaint",
  );
  {
    // Across the bar rather than down it, Shift up: the fence he did not ask to
    // grind is still a fence. Measured as "did he reach the far side", which is
    // the only thing a player can see.
    const crossed = [];
    for (const id of ["flat-bar", "handrail-6", "handrail-3"]) {
      const line = RAILS.find((r) => r.id === id);
      const axis = Math.atan2(line.b.x - line.a.x, line.b.z - line.a.z);
      for (const fps of RATES) {
        for (const v of [8, 14]) {
          const dt = 1 / fps;
          // Square across the middle of the bar, from 5 m out.
          const heading = axis + Math.PI / 2;
          const mx = (line.a.x + line.b.x) / 2;
          const mz = (line.a.z + line.b.z) / 2;
          const sx = mx - Math.sin(heading) * 5;
          const sz = mz - Math.cos(heading) * 5;
          const model = new SkateModel({}, STREET_SPOT);
          model.position.set(sx, STREET_SPOT.height(sx, sz), sz);
          model.heading = heading;
          model.speed = v;
          const keys = hands(dt);
          for (let i = 0; i < Math.round(2.2 / dt); i++) model.update(keys([]), dt);
          // Which side of the bar's line he ended on, signed along the approach.
          const side =
            (model.position.x - mx) * Math.sin(heading) + (model.position.z - mz) * Math.cos(heading);
          if (side > 0) crossed.push(`${id}@${v}m/s ${fps}fps out the far side by ${side.toFixed(2)} m`);
        }
      }
    }
    check(
      "…but the bar he declined is still steel — nobody rides through one",
      crossed.length === 0,
      crossed.length
        ? `${crossed.length}/18 got past: ${crossed.slice(0, 6).join(" · ")}`
        : "0/18 approaches reached the far side — three bars taken square across the middle, 8 and 14 m/s, 30/60/144 fps, nothing held throughout",
      "src/skate/skate-model.ts `advanceStep` — the `steelStep` line removed, which is the game as the player reported it — 18/18 got past: flat-bar@8m/s 30fps out the far side by 3.16 m, handrail-6 by 3.24 m, handrail-3 by 3.15 m, and the same at every speed and rate",
    );
  }
  // WHAT THE KEY IS FOR NOW, and it is the one entry riding onto a line cannot
  // ask for: the deck laid SQUARE across it. Coming at a bar sideways and popping
  // over is how you boardslide in this game (`settleAngle` lays the deck across
  // the line) and it is also how you hop the thing on the way somewhere else —
  // the same approach, the same arc and the same frame, so no geometry separates
  // them and only the player can. Measured on `tools/grind-auto.mjs`: 165 of 1432
  // such hops lock on when nothing refuses them.
  {
    const across = (extra) => {
      let caught = 0;
      let total = 0;
      for (const fps of RATES)
        for (const id of ["flat-bar", "handrail-3"])
          for (const v of [6, 8]) {
            // 0.8 s of run-up: an ollie is 1.57 m over 0.86 s, so a square
            // crossing has to be popped a whole hang time out or it sails over.
            const r = atRail(id, v, fps, popThen(extra), { across: true, lead: v * 0.8, seconds: 2 });
            total++;
            if (r.events.some((e) => e.startsWith("grind:"))) caught++;
          }
      return { caught, total };
    };
    const bare = across([]);
    const asked = across(["KeyE"]);
    check(
      "…but a line taken SQUARE across still waits to be asked, and E is the asking",
      bare.caught === 0 && asked.caught > 0,
      `square across: ${bare.caught}/${bare.total} with nothing held, ${asked.caught}/${asked.total} with E — flat-bar and handrail-3, 6/8 m/s, 30/60/144 fps`,
      "src/skate/skate-model.ts `tryCatchGrind` — the square gate deleted " +
        "(`if (this.grind.squareEntry && !this.slideWanted) return false`) — 12/12 lock on with " +
        "nothing held, i.e. hopping the bar boardslides it",
    );
  }
}

// The three rules the catch already had, all of them measured WITH the key held
// — the stronger reading, since a rule that survives the key surviving is a rule
// that survives the automatic entry too. This is the half of the ask that was
// never "add a button" or "take one away": neither may become a way round the
// rules the earlier rounds put in.
{
  // 1. A rail is a LANDING SURFACE — it takes him on the way down.
  const down = RATES.map((fps) => atRail("flat-bar", 10, fps, popThen(["KeyE"])));
  check(
    "with E held, a rail is still a landing surface",
    down.every((r) => r.events.some((e) => e.startsWith("grind:")) && r.onLine > 3),
    RATES.map((fps, i) => `${fps}fps ${down[i].events.join(",") || "nothing"} (${down[i].onLine} frames on the line)`).join(" · "),
    "src/skate/skate-model.ts `tryCatchGrind` — `return false` unconditionally — nothing at any rate, 0 frames on the line",
  );

  // 2. …and it DECLINES on a rising frame. The handrail sits 1.15 m up at its
  //    top end and is reached by rising to it off the platform, so a catch here
  //    at all is the round-5 rule still working.
  const rising = [4, 8, 12].map((v) =>
    RATES.map((fps) => atRail("handrail-6", v, fps, popThen(["KeyE"]))),
  );
  const risingCaught = rising.flat().filter((r) => r.events.some((e) => e.startsWith("grind:"))).length;
  check(
    "…and an ollie that RISES to a handrail still catches it",
    risingCaught === rising.flat().length,
    `${risingCaught}/${rising.flat().length} — 4/8/12 m/s at 30/60/144 fps`,
    "src/skate/skate-model.ts `flight()` — ask the Grinder only while `vy <= 0` — 3/9, which is the bug round 5 fixed and this button could have re-introduced",
  );

  // 3. …and `flip < 1` still puts him down. A kickflip flicked at the rail with
  //    no room to come round is a bail, key held or not — the button decides
  //    whether a rail may ask, never what it answers.
  // Popped 6 m out so he is on the way DOWN when the trucks arrive — a rising
  // board is refused by the rule above and would never reach this question —
  // and the deck flicked at 0.42 s, so `FLIP_TIME` still has 0.4 s to run when
  // he gets there. Timed in seconds, not frames, or the flick lands in a
  // different part of the arc at each rate.
  const flipped = RATES.map((fps) =>
    atRail("flat-bar", 10, fps, (_i, t) =>
      t < 0.05 ? ["Space", "KeyE"] : t >= 0.42 && t < 0.47 ? ["KeyE", "KeyF"] : ["KeyE"],
    { lead: 6, seconds: 2.2 }),
  );
  check(
    "…and a deck still coming round is still a bail, not a free grind",
    flipped.every((r) => r.events.includes("bail") && !r.events.some((e) => e.startsWith("grind:"))),
    RATES.map((fps, i) => `${fps}fps ${flipped[i].events.join(",") || "nothing"}`).join(" · "),
    "src/skate/skate-model.ts `tryCatchGrind` — delete the `flipWas` test — 3/3 grind clean off a kickflip that never came round",
  );

  // 4. Letting GO of it mid-grind is not a bail. The ask was for a choice about
  //    getting ON, and a key release that threw him off a line he is balanced
  //    on would be a different game.
  const dropped = RATES.map((fps) =>
    atRail("flat-bar", 10, fps, (i) => (i < 2 ? ["Space", "KeyE"] : i < 40 ? ["KeyE"] : []), {
      seconds: 2.2,
    }),
  );
  check(
    "…and letting go of it mid-grind does not throw him off",
    dropped.every((r) => !r.events.includes("grind-lost") && !r.events.includes("bail")),
    RATES.map((fps, i) => `${fps}fps ${dropped[i].events.join(",")} (${dropped[i].onLine} frames on the line)`).join(" · "),
    "src/skate/skate-model.ts `updateGrind` — add `if (!this.slideWanted) { endGrind(true); enterRagdoll(); }` — grind-lost,bail at 60 and 144 fps",
  );
}

// --- item 9: the flick and the key, same trick (M16) ---
//
// The flick pad throws through `SkateInputSource.flickTrick`, which is one
// `press()` call — the same one a key runs. So a flicked kickflip and a
// pressed F must read byte-identical out of `consume()`, at every rate, and a
// flicked Space must read as the tap it is. A flick that produced a different
// trick than the key would be a second game, so this is parity, not behaviour.
console.log("--- item 9: the flick and the key, same trick ---\n");
{
  const fresh = (dt) => {
    const listeners = {};
    const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
    globalThis.window = {
      addEventListener: (t, f) => void (listeners[t] ??= []).push(f),
      removeEventListener: () => {},
    };
    const src = new SkateInputSource();
    src.attach();
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete globalThis.window;
    src.consume(dt); // the loop was already running when the hands arrived
    const fire = (type, code) =>
      listeners[type]?.forEach((f) => f({ code, repeat: false, preventDefault() {} }));
    return { src, fire };
  };
  const snap = (input) => ({
    o: input.olliePressed,
    k: input.kickflipPressed,
    h: input.heelflipPressed,
    s: input.shoveitPressed,
    c: input.chargeHeld,
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const [code, flag] of [["KeyF", "k"], ["KeyG", "h"], ["KeyC", "s"]]) {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const a = fresh(dt);
      a.fire("keydown", code);
      const viaKey = snap(a.src.consume(dt));
      const b = fresh(dt);
      b.src.flickTrick(code);
      const viaFlick = snap(b.src.consume(dt));
      return { viaKey, viaFlick };
    });
    check(
      `flick ${code} reads exactly as the ${code} key`,
      got.every((r) => same(r.viaKey, r.viaFlick) && r.viaFlick[flag] === true),
      RATES.map((fps, i) => `${fps}fps key ${JSON.stringify(got[i].viaKey)} · flick ${JSON.stringify(got[i].viaFlick)}`).join(" · "),
      "src/skate/input.ts — `flickTrick` throwing every code at the heelflip latch instead of `press(code)` — flick reads {h:true} against the key's latch at every rate",
    );
  }

  // Space flicks as a tap: press and release inside one gesture, which is the
  // instant ollie — wind-up never held, pop armed.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const a = fresh(dt);
      a.fire("keydown", "Space");
      a.fire("keyup", "Space");
      const viaTap = snap(a.src.consume(dt));
      const b = fresh(dt);
      b.src.flickTrick("Space");
      const viaFlick = snap(b.src.consume(dt));
      return { viaTap, viaFlick };
    });
    check(
      "flick Space reads exactly as a Space tap",
      got.every((r) => same(r.viaTap, r.viaFlick) && r.viaFlick.o === true && r.viaFlick.c === false),
      RATES.map((fps, i) => `${fps}fps tap ${JSON.stringify(got[i].viaTap)} · flick ${JSON.stringify(got[i].viaFlick)}`).join(" · "),
      "src/skate/input.ts — `flickTrick` throwing Space at the heelflip latch instead of a press+release tap — flick reads {h:true} against the tap's {o:true} at every rate",
    );
  }

  // …and a flick nobody is reading is not input, like every other press.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const { src } = fresh(dt);
      // READ_TIMEOUT_MS is 330: sleep past it so the source is stale, however
      // fast the machine is — the stamp predates the sleep by construction.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
      src.flickTrick("KeyF");
      return snap(src.consume(dt));
    });
    check(
      "a stale flick queues nothing",
      got.every((r) => r.k === false && r.h === false && r.s === false && r.o === false && r.c === false),
      RATES.map((fps, i) => `${fps}fps ${JSON.stringify(got[i])}`).join(" · "),
      "src/skate/input.ts — `flickTrick` without the `live()` gate — stale flick latches {h:true} at every rate, i.e. a title-screen swipe queues a trick",
    );
  }
}

// --- item 10: the pad and the PDF, same ride (gamepad) ---
//
// The controller runs the PDF's Flick-it layout and nothing else, so a pad
// input must read byte-identical to the keyboard key that reaches the same
// verb: A holds like W, B brakes like S, Y winds and pops like Space, LB/RB
// hold like E/Shift, LT/RT grab like X, the right stick crouches and flicks
// through `flickTrick` like the touch pad, Start raises the pause latch, X
// and R3 tap reset like R — at every rate. Scripted pads (the feeder takes
// its provider as an argument), real source, real `consume()`.
console.log("--- item 10: the pad and the PDF, same ride ---\n");
{
  const { SkateGamepad } = await import("../src/controllers/gamepad/skate-gamepad.ts");

  const buttonsOf = (down) =>
    Array.from({ length: 16 }, (_, i) => ({ pressed: down.includes(i) }));
  /** A pad that plays `script(frame)` — `{ axes, down }` per frame, or null
   *  for unplugged — feeding a fresh real source, polled like the loop does. */
  const padHands = (dt, script) => {
    const listeners = {};
    const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
    globalThis.window = {
      addEventListener: (t, f) => void (listeners[t] ??= []).push(f),
      removeEventListener: () => {},
    };
    const src = new SkateInputSource();
    src.attach();
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete globalThis.window;
    src.consume(dt);
    let frame = 0;
    const gp = new SkateGamepad(src, () => {
      const s = script(frame);
      return s ? [{ axes: s.axes, buttons: buttonsOf(s.down) }] : [];
    });
    return {
      src,
      step() {
        gp.poll();
        const input = src.consume(dt);
        frame++;
        return input;
      },
    };
  };
  const NEUTRAL = { axes: [0, 0, 0, 0], down: [] };
  const j = (v) => JSON.stringify(v);

  // Full-right stick vs held KeyD: the smoothing ramp is shared, so the whole
  // series must match, not just the settle.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const a = [];
      for (let i = 0; i < 30; i++) a.push(keys(["KeyD"]).steer);
      const p = padHands(dt, () => ({ axes: [1, 0, 0, 0], down: [] }));
      const b = [];
      for (let i = 0; i < 30; i++) b.push(p.step().steer);
      return { a, b };
    });
    check(
      "pad full-right reads exactly as KeyD held",
      got.every((r) => j(r.a) === j(r.b)),
      RATES.map((fps, i) => `${fps}fps settle ${got[i].b[29].toFixed(4)}`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — steer sign flipped — pad settles mirrored (-1) against the key's (+1) at every rate",
    );
  }

  // Left-stick Y is NOT a throttle any more (push is A, brake is B): full-up
  // on the stick must push nothing and brake nothing.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const p = padHands(dt, () => ({ axes: [0, -1, 0, 0], down: [] }));
      const series = [];
      for (let i = 0; i < 30; i++) series.push(p.step());
      return series;
    });
    check(
      "pad left-stick Y drives nothing",
      got.every((s) => s.every((x) => x.throttle === false && x.brake === false)),
      RATES.map((fps, i) => `${fps}fps throttle ${got[i].filter((x) => x.throttle).length}/30 brake ${got[i].filter((x) => x.brake).length}/30`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — left Y still gated to KeyW/KeyS — full-up pushes 30/30, i.e. the PDF's A-push has a second throttle",
    );
  }

  // A held vs W held: pushing, not popping, for three seconds.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const p = padHands(dt, () => ({ axes: [0, 0, 0, 0], down: [0] }));
      const a = [];
      const b = [];
      for (let i = 0; i < Math.round(3 / dt); i++) {
        a.push(keys(["KeyW"]));
        b.push(p.step());
      }
      return { a, b };
    });
    check(
      "pad A pushes exactly as KeyW held",
      got.every((r) => r.a.every((k, i) => k.throttle === r.b[i].throttle && k.brake === r.b[i].brake)),
      RATES.map((fps, i) => `${fps}fps throttle ${got[i].b.filter((x) => x.throttle).length}/${got[i].b.length} frames`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — A not held as KeyW — throttle 0/90 at 30fps (0/180, 0/432)",
    );
  }

  // B held vs S held: the brake.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const p = padHands(dt, () => ({ axes: [0, 0, 0, 0], down: [1] }));
      const a = [];
      const b = [];
      for (let i = 0; i < 10; i++) {
        a.push(keys(["KeyS"]));
        b.push(p.step());
      }
      return { a, b };
    });
    check(
      "pad B brakes exactly as KeyS held",
      got.every((r) => r.a.every((k, i) => k.brake === r.b[i].brake)),
      RATES.map((fps, i) => `${fps}fps brake ${got[i].b.filter((x) => x.brake).length}/10`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — B not held as KeyS — brake 0/10 at every rate",
    );
  }

  // Y held vs Space held: the wind-up, then the pop on release.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const p = padHands(dt, (i) => (i < 10 ? { axes: [0, 0, 0, 0], down: [3] } : NEUTRAL));
      const a = [];
      const b = [];
      for (let i = 0; i < 12; i++) {
        a.push(keys(i < 10 ? ["Space"] : []));
        b.push(p.step());
      }
      return { a, b };
    });
    check(
      "pad Y winds and pops exactly as Space",
      got.every(
        (r) =>
          r.a.every((k, i) => k.chargeHeld === r.b[i].chargeHeld) &&
          r.a[10].olliePressed === true &&
          r.b[10].olliePressed === true,
      ),
      RATES.map((fps, i) => `${fps}fps wind-up ${got[i].b.filter((x) => x.chargeHeld).length} frames, pop ${got[i].b[10].olliePressed}`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — Y wired as an edge latch instead of a hold — chargeHeld false the whole hold, pop never armed",
    );
  }

  // LB/RB/LT/RT holds vs E/Shift/X holds: one level each.
  for (const [pad, code, flag] of [[4, "KeyE", "slideHeld"], [5, "ShiftLeft", "manualHeld"], [6, "KeyX", "grabHeld"], [7, "KeyX", "grabHeld"]]) {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const viaKey = keys([code])[flag];
      const p = padHands(dt, () => ({ axes: [0, 0, 0, 0], down: [pad] }));
      const viaPad = p.step()[flag];
      return { viaKey, viaPad };
    });
    check(
      `pad button ${pad} holds exactly as ${code}`,
      got.every((r) => r.viaKey === true && r.viaPad === true),
      RATES.map((fps, i) => `${fps}fps key ${got[i].viaKey} · pad ${got[i].viaPad}`).join(" · "),
      `src/controllers/gamepad/skate-gamepad.ts — button ${pad} mapped to the wrong hold — pad reads false against the key's true at every rate`,
    );
  }

  // X tap vs R tap: step off / get back on is the reset latch.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const p = padHands(dt, (i) => (i === 0 ? { axes: [0, 0, 0, 0], down: [2] } : NEUTRAL));
      p.step();
      const latched = p.src.takeReset();
      p.step();
      const once = p.src.takeReset();
      return { latched, once };
    });
    check(
      "pad X taps reset exactly as R",
      got.every((r) => r.latched === true && r.once === false),
      RATES.map((fps, i) => `${fps}fps latch ${got[i].latched}, re-read ${got[i].once}`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — X not tapping KeyR — latch false at every rate",
    );
  }

  // Right stick down-hold vs Space hold: the crouch; release pops.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const p = padHands(dt, (i) => (i < 10 ? { axes: [0, 0, 0, 0.8], down: [] } : NEUTRAL));
      const series = [];
      for (let i = 0; i < 12; i++) series.push(p.step());
      return series;
    });
    check(
      "pad stick-down crouches and pops exactly as Space",
      got.every(
        (s) =>
          s.slice(0, 10).every((x) => x.chargeHeld === true) &&
          s[10].olliePressed === true,
      ),
      RATES.map((fps, i) => `${fps}fps wind-up ${got[i].filter((x) => x.chargeHeld).length} frames, pop ${got[i][10].olliePressed}`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — stick-down not holding Space — chargeHeld false through the hold at every rate",
    );
  }

  // Right stick flicks: up ollies, up-left kicks, up-right heels, down-left
  // and down-right shove — the PDF's diagonals, regular stance.
  const flicks = [
    ["up", [0, -0.9], "olliePressed"],
    ["up-left", [-0.7, -0.7], "kickflipPressed"],
    ["up-right", [0.7, -0.7], "heelflipPressed"],
    ["left", [-0.9, 0], "kickflipPressed"],
    ["right", [0.9, 0], "heelflipPressed"],
    ["down-left", [-0.6, 0.6], "shoveitPressed"],
    ["down-right", [0.6, 0.6], "shoveitPressed"],
  ];
  for (const [name, stick, flag] of flicks) {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const p = padHands(
        dt,
        (i) => (i < 3 ? NEUTRAL : i === 3 ? { axes: [0, 0, stick[0], stick[1]], down: [] } : NEUTRAL),
      );
      const series = [];
      for (let i = 0; i < 6; i++) series.push(p.step()[flag]);
      return series;
    });
    check(
      `pad flick ${name} reads exactly as its trick`,
      got.every((s) => s.filter(Boolean).length === 1 && s[3] === true),
      RATES.map((fps, i) => `${fps}fps ${got[i].filter(Boolean).length}x latched, frame ${got[i].indexOf(true)} of 6`).join(" · "),
      `src/controllers/gamepad/skate-gamepad.ts — ${name} sector misclassified — latch missing or on the wrong frame at every rate`,
    );
  }

  // Pull down, THEN flick up-left in one motion: the crouch spends into the
  // flip — kickflip latched, and no plain pop on the way out.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const p = padHands(dt, (i) =>
        i < 3 ? NEUTRAL : i < 6 ? { axes: [0, 0, 0, 0.8], down: [] } : i === 6 ? { axes: [0, 0, -0.7, -0.7], down: [] } : NEUTRAL,
      );
      const series = [];
      for (let i = 0; i < 9; i++) series.push(p.step());
      return series;
    });
    check(
      "pad down-then-up-left spends the crouch into a kickflip",
      got.every(
        (s) =>
          s[6].kickflipPressed === true &&
          s.every((x) => x.olliePressed === false),
      ),
      RATES.map((fps, i) => `${fps}fps kick ${got[i][6].kickflipPressed}, pops ${got[i].filter((x) => x.olliePressed).length}`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — no intra-crouch redirect — the up-left never fires and the release pops a plain ollie",
    );
  }

  // Start vs the pause latch.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const p = padHands(dt, (i) => (i === 0 ? { axes: [0, 0, 0, 0], down: [9] } : NEUTRAL));
      p.step();
      return p.src.takePausePressed();
    });
    check(
      "pad Start raises the pause latch",
      got.every((v) => v === true),
      RATES.map((fps, i) => `${fps}fps ${got[i]}`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — Start not wired to pressPause — latch false at every rate",
    );
  }

  // Unplugged mid-wind-up: he stands up, he does NOT pop.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const p = padHands(dt, (i) => (i < 5 ? { axes: [0, 0, 0, 0], down: [3] } : null));
      const series = [];
      for (let i = 0; i < 7; i++) series.push(p.step());
      // The verdict is the FIRST frame after the plug is pulled (index 5).
      return series[5];
    });
    check(
      "unplugged mid-wind-up stands him up without popping",
      got.every((o) => o.chargeHeld === false && o.olliePressed === false),
      RATES.map((fps, i) => `${fps}fps charge ${got[i].chargeHeld} pop ${got[i].olliePressed}`).join(" · "),
      "src/controllers/gamepad/skate-gamepad.ts — disconnect releasing Space instead of dropping it — olliePressed true, i.e. yanking the plug pops him",
    );
  }
}

// --- item 11: the mash-up's arcade row -------------------------------------
//
// J/L/I/K throw the same latches F/G/C always did, U/O/Y/H/N hold a grab AND
// name it, M manuals (Shift+M noses), G holds the grind key, V latches a
// revert, B brakes, and Space still winds — with the wind-up's own length now
// buying air past a deadband. Driven through the real source, the real book,
// the real Grinder and the real model, at 30/60/144 fps throughout.
console.log("--- item 11: the mash-up's arcade row ---\n");
{
  const { TrickBook } = await import("../src/skate/tricks.ts");
  const { Grinder } = await import("../src/skate/grind.ts");

  // J/L/I/K land on exactly the latches F/G/C always set — one press, one
  // hand-out, then clear. Same flags, same edges, new keys.
  for (const [code, flag] of [["KeyJ", "kickflipPressed"], ["KeyL", "heelflipPressed"], ["KeyK", "shoveitPressed"], ["KeyI", "treflipPressed"]]) {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      // Read the SAME consume the press went into: the latch is handed out
      // once, so the frame after is already clear. (Reading one frame late
      // was the first version of this check, and it proved nothing.)
      const first = keys([code])[flag];
      const second = keys([])[flag];
      return { first, second };
    });
    check(
      `${code} latches exactly once, like the flick keys`,
      got.every((r) => r.first === true && r.second === false),
      RATES.map((fps, i) => `${fps}fps first ${got[i].first}, re-read ${got[i].second}`).join(" · "),
      `src/skate/input.ts — press() missing the ${code} latch — first read false at every rate`,
    );
  }

  // …and the book resolves them: treflip is a real trick id, not a rename.
  {
    const book = new TrickBook();
    const ctx = { grounded: false, airborne: true, grinding: false, stance: "regular", speed: 8, fakie: false, flipping: false };
    check(
      "the book resolves a treflip off the I latch",
      book.resolve({ treflipPressed: true }, ctx) === "treflip",
      `resolve → ${book.resolve({ treflipPressed: true }, ctx)}`,
      "src/skate/tricks.ts — resolve() with no treflip branch — null, i.e. I does nothing airborne",
    );
  }

  // U/O/Y/H/N name their grab outright; X still reads the stick. Driven
  // through the REAL source (press → consume), because the wiring at risk is
  // the key-to-flavour map in `press()`, not the book's `grabKey` reader —
  // handing the book a flavour directly would prove nothing about the keys.
  for (const [code, flavour] of [["KeyU", "Indy"], ["KeyO", "Melon"], ["KeyY", "Method"], ["KeyH", "Nosegrab"], ["KeyN", "Tailgrab"]]) {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const input = keys([code]);
      keys([]);
      return { held: input.grabHeld, key: input.grabKey };
    });
    check(
      `${code} holds a grab named ${flavour}`,
      got.every((r) => r.held === true && r.key === flavour),
      RATES.map((fps, i) => `${fps}fps held:${got[i].held} flavour:${got[i].key}`).join(" · "),
      `src/skate/input.ts — press() mapping ${code} to the wrong flavour — grabKey reads Indy, not ${flavour}`,
    );
    const book = new TrickBook();
    const ctx = { grounded: false, airborne: true, grinding: false, stance: "regular", speed: 8, fakie: false, flipping: false };
    const holding = book.held({ grabHeld: true, grabKey: flavour, steer: 0 }, ctx);
    check(
      `a ${flavour} grabKey banks a ${flavour}`,
      holding === "grab" && book.grabName === flavour,
      `held → ${holding}, flavour ${book.grabName}`,
      `src/skate/tricks.ts — held() ignoring grabKey — flavour falls back to stick (Indy), not ${flavour}`,
    );
  }

  // M manuals; Shift+M (and Q) ride the nose; Shift alone still manuals.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const m = keys(["KeyM"]);
      const shiftM = keys(["ShiftLeft", "KeyM"]);
      const shift = keys(["ShiftLeft"]);
      keys([]);
      return { m: m.manualHeld, nose: shiftM.noseManualHeld, shift: shift.manualHeld };
    });
    check(
      "M manuals, Shift+M noses, Shift alone still manuals",
      got.every((r) => r.m === true && r.nose === true && r.shift === true),
      RATES.map((fps, i) => `${fps}fps M:${got[i].m} Shift+M nose:${got[i].nose} Shift:${got[i].shift}`).join(" · "),
      "src/skate/input.ts — consume() with no M row — manual false everywhere M is held",
    );
  }

  // G holds the grind key; V latches a revert; B brakes like S.
  {
    const got = RATES.map((fps) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const g = keys(["KeyG"]);
      const v = keys(["KeyV"])[`revertPressed`];
      const vAgain = keys([]).revertPressed;
      const b = keys(["KeyB"]);
      keys([]);
      return { g: g.grindHeld, v, vAgain, b: b.brake };
    });
    check(
      "G holds grind, V latches revert once, B brakes",
      got.every((r) => r.g === true && r.v === true && r.vAgain === false && r.b === true),
      RATES.map((fps, i) => `${fps}fps grind:${got[i].g} revert:${got[i].v}/${got[i].vAgain} brake:${got[i].b}`).join(" · "),
      "src/skate/input.ts — V with no latch — revert false on first read at every rate",
    );
  }

  // G commits: 1.2 m/s is under the rail's own minimum, and only the key
  // gets him on. Asked of the real Grinder on a synthetic straight rail.
  {
    const rail = {
      id: "matrix-rail",
      a: new THREE.Vector3(-5, 1, 0),
      b: new THREE.Vector3(5, 1, 0),
      kind: "rail",
      surface: "metal",
      radius: 0.3,
    };
    const attempt = (grindWanted) => {
      const g = new Grinder();
      return g.catch(
        {
          x: 0, y: 1.2, z: 0.2, yPrev: 1.2, heading: Math.PI / 2, course: Math.PI / 2,
          speed: 1.2, stance: "regular", grindWanted,
        },
        [rail],
      );
    };
    const bare = attempt(false);
    const held = attempt(true);
    check(
      "G-held, a 1.2 m/s roll locks on; unheld it slides past",
      bare === null && held !== null,
      `unheld ${bare === null ? "declined" : "caught"} · held ${held === null ? "declined" : "caught"}`,
      "src/skate/grind.ts — catch() with no grindWanted widening — held declines exactly like bare",
    );
  }

  // The charge: a tap pops the pinned ollie to the decimal; a short hold
  // (inside the deadband) is byte-identical with it; a long hold buys real
  // air. Holds are SECONDS, not frames — the deadband is 0.12 s, so five
  // frames at 30 fps is already past it and correctly pops bigger. Ridden on
  // the real model, apex measured off `position.y` MINUS the spawn height it
  // started at (the pinned 1.5872 m is air, not altitude).
  {
    const ride = (fps, holdSeconds) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const model = new SkateModel({ onPush: () => {}, onPop: () => {} }, STREET_SPOT);
      const startY = model.position.y;
      const holdFrames = Math.max(1, Math.round(holdSeconds / dt));
      let apex = 0;
      const total = holdFrames + Math.round(3 / dt);
      for (let i = 0; i < total; i++) {
        const input = keys(i < holdFrames ? ["Space"] : []);
        model.update(input, dt);
        apex = Math.max(apex, model.position.y);
      }
      return apex - startY;
    };
    const got = RATES.map((fps) => {
      const tap = ride(fps, 0);
      const short = ride(fps, 0.08);
      const charged = ride(fps, 0.75);
      return { tap, short, charged };
    });
    check(
      "a tap pops the pinned ollie, a short hold matches it exactly",
      got.every((r) => Math.abs(r.tap - 1.5872) < 0.15 && r.short === r.tap),
      RATES.map((fps, i) => `${fps}fps tap ${got[i].tap.toFixed(4)} short ${got[i].short.toFixed(4)}`).join(" · "),
      "src/skate/skate-model.ts — charge scaling with no deadband — a 5-frame hold out-airs the tap",
    );
    check(
      "a long hold buys clearly bigger air",
      got.every((r) => r.charged > r.tap * 1.2),
      RATES.map((fps, i) => `${fps}fps charged ${got[i].charged.toFixed(3)} vs tap ${got[i].tap.toFixed(3)}`).join(" · "),
      "src/skate/skate-model.ts — pop() ignoring chargeT — charged apex equals the tap",
    );
  }

  // The revert, end to end: push, pop, land, V inside the window — the line
  // banks a Revert. V well after the window (2.5 s — counted in SECONDS, not
  // frames, so the window means the same at every rate) buys nothing.
  {
    const run = (fps, vAt) => {
      const dt = 1 / fps;
      const keys = hands(dt);
      const trickIds = [];
      const model = new SkateModel({ onPush: () => {}, onPop: () => {}, onTrick: (id) => trickIds.push(id) }, STREET_SPOT);
      let landedAt = -1;
      let wasAir = false;
      const total = Math.round(8 / dt);
      for (let i = 0; i < total; i++) {
        // Push for two seconds, tap an ollie, then hands off except V.
        const hold = i < Math.round(2 / dt) ? ["KeyW"] : i < Math.round(2 / dt) + 1 ? ["Space"] : [];
        const input = keys(i === vAt ? ["KeyV"] : hold);
        model.update(input, dt);
        if (model.state === "air") wasAir = true;
        if (wasAir && model.state === "rolling" && landedAt < 0) landedAt = i;
      }
      return { trickIds, landedAt };
    };
    const got = RATES.map((fps) => {
      const probe = run(fps, -1);
      if (probe.landedAt < 0) return { early: false, late: false, landedAt: -1 };
      const early = run(fps, probe.landedAt + 5);
      const late = run(fps, probe.landedAt + Math.round(2.5 * fps));
      return {
        early: early.trickIds.includes("revert"),
        late: late.trickIds.includes("revert"),
        landedAt: probe.landedAt,
      };
    });
    check(
      "V just after touchdown banks a Revert",
      got.every((r) => r.landedAt >= 0 && r.early === true),
      RATES.map((fps, i) => `${fps}fps landed@${got[i].landedAt} revert:${got[i].early}`).join(" · "),
      "src/skate/skate-model.ts — no revert gate in the roll — V after landing banks nothing",
    );
    check(
      "V eighty frames later buys nothing",
      got.every((r) => r.landedAt < 0 || r.late === false),
      RATES.map((fps, i) => `${fps}fps late-revert:${got[i].late}`).join(" · "),
      "src/skate/skate-model.ts — revert with no window — a stale V still banks",
    );
  }
  // Difficulty: the catch floor breathes with it — chill takes a 1.5 m/s
  // roll normal slides past; gnarly waves off a 2.0 the normal game keeps.
  // Node has no localStorage, so the harness lends the settings module an
  // in-memory one (tools/ is outside the game — no seam in shipped code).
  {
    const shim = (() => {
      const store = new Map();
      return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      };
    })();
    globalThis.localStorage = shim;
    const { setDifficulty } = await import("../src/skate/difficulty.ts");
    const rail = {
      id: "matrix-rail-diff",
      a: new THREE.Vector3(-5, 1, 0),
      b: new THREE.Vector3(5, 1, 0),
      kind: "rail",
      surface: "metal",
      radius: 0.3,
    };
    const attempt = (speed) => {
      const g = new Grinder();
      return g.catch(
        {
          x: 0, y: 1.2, z: 0.2, yPrev: 1.2, heading: Math.PI / 2, course: Math.PI / 2,
          speed, stance: "regular",
        },
        [rail],
      );
    };
    setDifficulty("normal");
    const normalSlow = attempt(1.5);
    const normalFast = attempt(2.0);
    setDifficulty("chill");
    const chillSlow = attempt(1.5);
    setDifficulty("gnarly");
    const gnarlyFast = attempt(2.0);
    setDifficulty("normal");
    delete globalThis.localStorage;
    check(
      "chill catches the 1.5 roll normal slides past",
      normalSlow === null && chillSlow !== null,
      `normal ${normalSlow === null ? "declined" : "caught"} · chill ${chillSlow === null ? "declined" : "caught"}`,
      "src/skate/grind.ts — catch floor ignoring difficultyTuning — chill declines exactly like normal",
    );
    check(
      "gnarly waves off the 2.0 normal keeps",
      normalFast !== null && gnarlyFast === null,
      `normal ${normalFast === null ? "declined" : "caught"} · gnarly ${gnarlyFast === null ? "declined" : "caught"}`,
      "src/skate/grind.ts — catch floor ignoring difficultyTuning — gnarly catches exactly like normal",
    );
  }
}

void THREE;

const failed = results.filter((r) => !r.pass);
const unproven = results.filter((r) => !r.proof);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(" · ")}`);
console.log(
  `${results.length - unproven.length}/${results.length} watched failing against deliberately broken code`,
);
process.exitCode = failed.length ? 1 : 0;
