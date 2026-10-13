// How forgiving the game is — Chill / Normal / Gnarly, per device.
//
// The plan file's M22 asked for rust-engine-style difficulty: catch windows
// and balance rates, live, from the settings screen. So that is exactly what
// this owns and nothing else: three multipliers read at the moment they are
// used (the Grinder's catch, the grind/manual balance), never cached, so the
// settings screen takes effect on the next frame with no reboot and no
// re-thread. Normal is all ones — every pinned number was measured on it,
// and flipping back reads byte-identical to never having left.
//
// Persisted in localStorage like the quality picker (a property of the
// device's player, not the account), default Normal, garbage in storage
// reads as Normal rather than failing a boot over two words.
export type Difficulty = "chill" | "normal" | "gnarly";

const KEY = "skate:difficulty";

export function getDifficulty(): Difficulty {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "chill" || v === "gnarly") return v;
  } catch {
    /* storage blocked */
  }
  return "normal";
}

export function setDifficulty(d: Difficulty): void {
  try {
    localStorage.setItem(KEY, d);
  } catch {
    /* storage blocked */
  }
}

export interface DifficultyTuning {
  /** Grind catch windows (reach/above/below) and the minimum catch speed. */
  catching: number;
  /** How hard balance drifts and tips (grind TIP, manual TIP). */
  tip: number;
  /** How hard steering corrects balance (grind CORRECT, manual CORRECT). */
  correct: number;
}

const TUNING: Record<Difficulty, DifficultyTuning> = {
  // Wide rails, slow tips, strong corrections. A learner's game, honestly so.
  chill: { catching: 1.3, tip: 0.7, correct: 1.25 },
  normal: { catching: 1, tip: 1, correct: 1 },
  // Narrow rails, fast tips, weak corrections. The same physics, less mercy.
  gnarly: { catching: 0.8, tip: 1.3, correct: 0.8 },
};

/** Read live at every use site — settings changes land on the next frame. */
export function difficultyTuning(): DifficultyTuning {
  return TUNING[getDifficulty()];
}
