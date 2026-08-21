import { matchAplRule } from "./apl-ir.js";

const EPSILON = 0.0001;

export class FeralAPLAdapter {
  constructor(profile) {
    this.profile = profile;
    this.actionById = profile.actionById;
    this.rules = profile.apl.rules;
  }

  recommend(view) {
    if (view.status === "ended") return this.#wait("session.ended", "训练已结束", null);
    if (view.status !== "running") return this.#wait("session.idle", "开始训练后显示下一技能", null);
    if (view.channel) {
      const action = this.actionById[view.channel.skillId];
      return this.#wait("channel.wait", `等待${action?.name ?? "技能"}引导完成`, view.channel.endsAt - view.nowMs);
    }

    for (const rule of this.rules) {
      const match = matchAplRule(rule, { view, profile: this.profile });
      if (!match) continue;
      return this.#recommendAction(rule, match, view);
    }
    return this.#wait("apl.no_match", "当前 APL 子集没有可执行动作", 100);
  }

  #recommendAction(rule, match, view) {
    const action = this.actionById[rule.actionId];
    const cost = view.effectiveCost(action);
    if (cost > view.energy + EPSILON) {
      const waitMs = ((cost - view.energy) / view.energyRegenPerSecond) * 1000;
      return this.#wait("resource.pool", `为${action.name}等待能量：${Math.floor(view.energy)} / ${cost}`, waitMs, {
        intendedSkillId: action.id,
        intendedTargetIndex: match.targetIndex,
        intendedRuleId: rule.id,
      });
    }
    return {
      skillId: action.id,
      targetIndex: match.targetIndex,
      action: action.name,
      ruleId: rule.id,
      aplList: rule.list,
      aplLine: rule.line,
      sourceCondition: rule.source.condition,
      fidelity: rule.fidelity,
      reason: match.reason,
      waitMs: 0,
    };
  }

  #wait(ruleId, reason, waitMs, metadata = {}) {
    return {
      skillId: null,
      targetIndex: null,
      action: "等待",
      ruleId,
      aplList: ruleId === "resource.pool" ? "finisher" : null,
      aplLine: ruleId === "resource.pool" ? 58 : null,
      sourceCondition: ruleId === "resource.pool" ? "pool_resource,for_next=1" : null,
      fidelity: "interactive-harness",
      reason,
      waitMs: waitMs == null ? null : Math.max(0, Math.ceil(waitMs)),
      ...metadata,
    };
  }
}
