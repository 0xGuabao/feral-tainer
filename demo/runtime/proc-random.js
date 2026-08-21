const MODES = new Set(["random", "seeded", "scripted"]);

function systemSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  }
  return (Date.now() ^ 0xa5a5a5a5) >>> 0 || 1;
}

export class ProcRandom {
  constructor({ mode = "seeded", seed = 1210001, script = [] } = {}) {
    if (!MODES.has(mode)) throw new Error(`Unknown proc RNG mode '${mode}'`);
    this.mode = mode;
    this.seed = mode === "random" ? systemSeed() : Number(seed) >>> 0 || 1;
    this.state = this.seed;
    this.drawCount = 0;
    this.script = Array.isArray(script)
      ? script.map((entry, index) => ({ ...entry, index, consumed: false }))
      : [];
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const result = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    this.drawCount += 1;
    return result;
  }

  roll(effectId, chance, context = {}) {
    const boundedChance = Math.max(0, Math.min(1, chance));
    if (this.mode === "scripted") {
      const matched = this.consumeScript(effectId, context);
      return {
        triggered: Boolean(matched),
        roll: matched ? 0 : 1,
        chance: boundedChance,
        mode: this.mode,
        scriptIndex: matched?.index ?? null,
      };
    }

    const roll = this.next();
    return {
      triggered: roll < boundedChance,
      roll,
      chance: boundedChance,
      mode: this.mode,
      scriptIndex: null,
    };
  }

  consumeScript(effectId, context = {}) {
    if (this.mode !== "scripted") return null;
    const matched = this.script.find(
      (entry) =>
        !entry.consumed &&
        entry.effectId === effectId &&
        (entry.hook == null || entry.hook === context.hook) &&
        (entry.afterActionCount == null || entry.afterActionCount === context.actionCount) &&
        (entry.atTimeMs == null || entry.atTimeMs <= context.timestamp),
    );
    if (matched) matched.consumed = true;
    return matched ?? null;
  }

  snapshot() {
    return {
      mode: this.mode,
      seed: this.seed,
      state: this.state,
      drawCount: this.drawCount,
      scriptRemaining: this.script.filter((entry) => !entry.consumed).length,
      algorithm: "mulberry32-js-harness",
      matchesSimulationCraftSequence: false,
    };
  }
}

export const PROC_RANDOM_MODES = Object.freeze([...MODES]);
