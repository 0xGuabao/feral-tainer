function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function actionResultRollId(actionId, targetIndex) {
  return `action-result:${actionId}:${targetIndex}`;
}

export class ActionResultResolver {
  constructor({ rng, emit }) {
    this.rng = rng;
    this.emit = emit;
  }

  resolve({ action, targetIndices, critChance, timestamp, actionCount, isProc = false }) {
    const boundedCritChance = clamp(Number(critChance) || 0, 0, 1);
    const results = targetIndices.map((targetIndex) => {
      const rollId = actionResultRollId(action.id, targetIndex);
      const roll = this.rng.roll(rollId, boundedCritChance, {
        hook: "on_action_result",
        timestamp,
        actionCount,
        targetIndex,
      });
      const result = {
        actionId: action.id,
        targetIndex,
        hit: true,
        crit: roll.triggered,
        result: roll.triggered ? "crit" : "hit",
        critChance: boundedCritChance,
        roll: roll.roll,
        rngMode: roll.mode,
        scriptIndex: roll.scriptIndex,
        rollId,
        isProc,
      };
      this.emit("ACTION_RESULT", {
        sourceSkillId: action.id,
        targetIndex,
        before: null,
        after: result.result,
        reason: roll.triggered ? "critical-hit" : "hit",
        metadata: result,
      });
      return result;
    });
    const critCount = results.filter((result) => result.crit).length;
    return {
      hitCount: results.length,
      critCount,
      anyCrit: critCount > 0,
      allCrit: results.length > 0 && critCount === results.length,
      results,
    };
  }
}
