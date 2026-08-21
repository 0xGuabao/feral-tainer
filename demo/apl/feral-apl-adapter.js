const EPSILON = 0.0001;

function findDotTarget(view, dotId, { refreshableOnly = false, minimumRemaining = false } = {}) {
  const candidates = view.targets
    .map((target) => ({
      index: target.index,
      dot: target.dots[dotId] ?? null,
      remains: view.dotRemaining(target.dots[dotId] ?? null),
    }))
    .filter((entry) => !refreshableOnly || view.dotRefreshable(entry.dot));
  if (!candidates.length) return null;
  if (minimumRemaining || refreshableOnly) {
    candidates.sort((left, right) => left.remains - right.remains || left.index - right.index);
  }
  return candidates[0].index;
}

const CONDITIONS = Object.freeze({
  tigers_fury: ({ view }) =>
    view.cooldownRemaining("tigersFury") <= EPSILON
      ? { targetIndex: null, reason: "按当前构筑 APL 使用猛虎之怒；增伤、战略灌注与追猎收益优先于回能防溢出" }
      : null,
  stealth_rake: ({ view }) =>
    view.hasAura("prowl")
      ? { targetIndex: view.activeTargetIndex, reason: "潜行起手：使用强化斜掠" }
      : null,
  berserk: ({ view, profile }) => {
    const actionId = profile.replacements.berserk ?? "berserk";
    return view.hasAura("tigersFury") && view.cooldownRemaining(actionId) <= EPSILON
      ? { targetIndex: null, reason: "猛虎之怒窗口已开启，进入狂暴" }
      : null;
  },
  apex_bite: ({ view }) =>
    view.hasAura("apexPredatorsCraving")
      ? { targetIndex: view.activeTargetIndex, reason: "顶级捕食者触发：立即使用免费满星凶猛撕咬" }
      : null,
  feral_frenzy: ({ view }) => {
    const threshold = view.hasAura("berserk") ? 4 : 2;
    return view.cooldownRemaining("feralFrenzy") <= EPSILON && view.comboPoints <= threshold
      ? { targetIndex: view.activeTargetIndex, reason: `连击点 ${view.comboPoints} ≤ ${threshold}` }
      : null;
  },
  convoke: ({ view, profile }) => {
    const action = profile.actionById.convoke;
    const guidance = Boolean(action?.channel?.parameters?.guidance);
    const berserkActionId = profile.replacements.berserk ?? "berserk";
    const berserkAligned = view.hasAura("berserk") || (
      guidance && view.cooldownRemaining(berserkActionId) > 45000
    );
    const previousFinisher = ["rip", "ferociousBite", "primalWrath"].includes(view.lastGcdActionId);
    const tigerFuryWindow = view.auraRemaining("tigersFury") <= 1000 + (action?.channel?.durationMs ?? 0);
    const executeNow =
      view.cooldownRemaining("convoke") <= EPSILON &&
      view.hasAura("tigersFury") &&
      berserkAligned &&
      (previousFinisher || tigerFuryWindow);
    if (executeNow) {
      return {
        targetIndex: view.activeTargetIndex,
        reason: guidance && !view.hasAura("berserk")
          ? "阿莎曼的指引允许万灵与本轮狂暴错开"
          : "猛虎之怒与狂暴重叠，且上一公共冷却为终结技",
      };
    }
    return view.fightRemainingMs < 5000 && view.cooldownRemaining("convoke") <= EPSILON
      ? { targetIndex: view.activeTargetIndex, reason: "战斗剩余不足 5 秒，立即使用万灵" }
      : null;
  },
  single_rip: ({ view }) => {
    if (view.targetCount !== 1 || view.comboPoints < 5) return null;
    const rip = view.targets[0].dots.rip;
    return view.dotRefreshable(rip) &&
      (view.hasAura("tigersFury") || view.dotRemaining(rip) < view.cooldownRemaining("tigersFury"))
      ? { targetIndex: 0, reason: "5 连击点且割裂进入可刷新窗口" }
      : null;
  },
  bite: ({ view, profile }) => {
    if (view.comboPoints < 5) return null;
    const targetIndex = findDotTarget(view, "rip", { minimumRemaining: true }) ?? view.activeTargetIndex;
    if (view.targetCount > 1) {
      const refreshTarget = findDotTarget(view, "rip", { refreshableOnly: true });
      if (refreshTarget != null) return null;
      const hasPrimalWrath = Boolean(profile.actionById.primalWrath);
      const rampantFerocity = Boolean(profile.build.talents.byToken.rampant_ferocity);
      const bloodseekerWindow =
        view.targetCount < 5 &&
        view.dotRemaining(view.targets[targetIndex].dots.bloodseekerVines ?? null) > EPSILON;
      if (hasPrimalWrath && !rampantFerocity && !bloodseekerWindow) return null;
    }
    return {
      targetIndex,
      reason: view.targetCount > 1 && view.targets[targetIndex].dots.bloodseekerVines
        ? "目标存在血棘藤蔓且目标数低于 5，使用凶猛撕咬"
        : "核心流血无需刷新，使用凶猛撕咬",
    };
  },
  primal_wrath: ({ view }) =>
    view.targetCount > 1 && view.comboPoints >= 5
      ? { targetIndex: view.activeTargetIndex, reason: "多目标 5 连击点，使用原始之怒维护群体割裂" }
      : null,
  multi_rip: ({ view }) => {
    if (view.targetCount <= 1 || view.comboPoints < 5) return null;
    const targetIndex = findDotTarget(view, "rip", { refreshableOnly: true });
    return targetIndex == null
      ? null
      : { targetIndex, reason: `为木桩 ${targetIndex + 1} 维护独立割裂` };
  },
  multi_rake: ({ view, profile }) => {
    if (view.targetCount <= 1) return null;
    const panthersGuile = Boolean(profile.build.talents.byToken.panthers_guile);
    const minimumRakes = Math.min(view.targetCount, panthersGuile ? 2 : 3);
    const activeRakes = view.targets.filter((target) => !view.dotRefreshable(target.dots.rake)).length;
    if (activeRakes >= minimumRakes) return null;
    const targetIndex = findDotTarget(view, "rake", { refreshableOnly: true });
    return targetIndex == null
      ? null
      : { targetIndex, reason: `保持至少 ${minimumRakes} 个有效斜掠` };
  },
  multi_moonfire: ({ view }) => {
    if (view.targetCount <= 1) return null;
    const targetIndex = findDotTarget(view, "moonfire", { refreshableOnly: true });
    return targetIndex == null
      ? null
      : { targetIndex, reason: `木桩 ${targetIndex + 1} 的月火可刷新` };
  },
  multi_swipe: ({ view }) =>
    view.targetCount > 1
      ? { targetIndex: view.activeTargetIndex, reason: "多目标持续伤害均安全，使用横扫建造" }
      : null,
  single_rake: ({ view }) =>
    view.targetCount === 1 && view.dotRefreshable(view.targets[0].dots.rake)
      ? { targetIndex: 0, reason: "斜掠缺失或进入 Pandemic 刷新窗口" }
      : null,
  single_moonfire: ({ view }) =>
    view.targetCount === 1 && view.dotRefreshable(view.targets[0].dots.moonfire)
      ? { targetIndex: 0, reason: "月火缺失或进入 Pandemic 刷新窗口" }
      : null,
  single_shred: ({ view }) =>
    view.targetCount === 1
      ? { targetIndex: 0, reason: "核心持续伤害安全，使用撕碎建造" }
      : null,
});

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
      const condition = CONDITIONS[rule.condition];
      if (!condition) continue;
      const match = condition({ view, profile: this.profile, rule });
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
      sourceCondition: rule.condition,
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

export const FERAL_APL_CONDITION_IDS = Object.freeze(Object.keys(CONDITIONS));
