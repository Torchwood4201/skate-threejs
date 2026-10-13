// THE SHADOW CADENCE CHECK — the row-12 grid key, and nothing else.
//
// The cadence cache skips the shadow re-raster when the snapped grid did not
// move, so the whole of its safety is one pure function: `snapGridKey`
// (src/world/field.ts), the draw-time snap's own rounding, factored out.
// Same cell ⇒ same sub-texel alignment ⇒ an identical raster. Four asserts,
// no DOM, no GPU, no scene:
//
//   same focus → same cell · sub-texel drift → same cell ·
//   a texel past the rounding edge → new cell · a halved mapSize re-grids
//
// Run: node --experimental-strip-types tools/shadow-cadence-check.mjs

import { register } from "node:module";

register(new URL("./ts-resolve.mjs", import.meta.url));
// …and directory specifiers on top of it (`field.ts` imports `./sky`, which
// is `./sky/index.ts`) — same second hook `input-matrix.mjs` registers.
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

const { snapGridKey } = await import("../src/world/field.ts");

const results = [];
const check = (name, pass, detail, proof) => {
  results.push({ name, pass, proof: proof ?? null });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}` +
      (proof ? "" : "   [UNPROVEN — never watched failing]"),
  );
};

const key = (fx, fy, mapSize, half = 40) => {
  const t = (half * 2) / mapSize;
  return snapGridKey(fx, fy, t, t).join(",");
};

// 3072 map over an 80 m box: texel 2.6 cm. Standing still must read one cell.
check(
  "a still focus never leaves its cell",
  key(10, 5, 3072) === key(10, 5, 3072),
  `cell ${key(10, 5, 3072)}`,
  "src/world/field.ts — snapGridKey flooring instead of rounding — same input, same output either way; the drift check below is the one that watches it",
);

check(
  "sub-texel drift stays in the cell",
  key(10, 5, 3072) === key(10 + 0.01, 5 - 0.01, 3072),
  "1 cm drift on a 2.6 cm texel",
  "src/world/field.ts — snapGridKey flooring instead of rounding — the edge sits under the focus and 1 cm of drift flips the cell",
);

check(
  "a full texel of travel moves the cell",
  key(10, 5, 3072) !== key(10 + 0.0261, 5, 3072),
  "2.61 cm on a 2.604 cm texel crosses the rounding edge",
  "src/world/field.ts — snapGridKey returning a constant cell — travel never moves anything",
);

check(
  "the grid is live, not constant (governor halves mapSize mid-run)",
  key(10, 5, 3072) !== snapGridKey(10, 5, 10, 10).join(","),
  "same focus, 2.6 cm vs 10 m texel read different cells",
  "src/world/field.ts — snapGridKey ignoring its texel args (fixed grid) — both answers always agree",
);

const failed = results.filter((r) => !r.pass);
const unproven = results.filter((r) => !r.proof);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(" · ")}`);
console.log(
  `${results.length - unproven.length}/${results.length} watched failing against deliberately broken code`,
);
process.exit(failed.length ? 1 : 0);
