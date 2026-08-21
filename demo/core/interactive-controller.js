import { FeralAPLAdapter } from "../apl/feral-apl-adapter.js";
import { ActionResultResolver } from "../runtime/action-result-resolver.js";
import { EffectRuntime } from "../runtime/effect-runtime.js";
import { ProcRandom, PROC_RANDOM_MODES } from "../runtime/proc-random.js";
import { normalizeBuildInput } from "./build-input.js";
import { BuildResolver } from "./build-resolver.js";
import { resolveDynamicCombatStats } from "./stat-resolver.js";

const EPSILON = 0.0001;
const MAX_HISTORY = 2000;

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export class InteractiveController {
  constructor({ resolver = new BuildResolver(), defaultBuildInput } = {}) {
    if (!defaultBuildInput) throw new Error("InteractiveController requires an injected defaultBuildInput");
    this.resolver = resolver;
    this.defaultBuildInput = normalizeBuildInput(defaultBuildInput);
    this.eventSequence = 0;
    this.sessionSequence = 0;
    this.resetSession();
  }

  startSession(options = {}) {
    const resolvedProfile = this.#resolveProfile(options);
    const targetCount = options.targetCount ?? 1;
    if (!resolvedProfile.session.targetCounts.includes(targetCount)) {
      throw new Error(`targetCount 仅支持 ${resolvedProfile.session.targetCounts.join("、")}。`);
    }
    if (!PROC_RANDOM_MODES.includes(options.procMode ?? "seeded")) {
      throw new Error(`procMode 仅支持 ${PROC_RANDOM_MODES.join("、")}。`);
    }

    this.profile = resolvedProfile;
    this.actionById = resolvedProfile.actionById;
    this.internalActionById = resolvedProfile.internalActionById;
    this.auraDefinitions = Object.fromEntries(
      resolvedProfile.tracked.auras.map((aura) => [aura.id, aura]),
    );
    this.sessionSequence += 1;
    this.#initializeState({
      targetCount,
      durationMs: options.durationMs ?? resolvedProfile.session.durationMs,
    });
    const procMode = options.procMode ?? "seeded";
    const seed = options.seed ?? 1210001;
    const script = options.scriptedProcs ?? [];
    const actionResultScript = script.filter((entry) => String(entry.effectId).startsWith("action-result:"));
    const effectScript = script.filter((entry) => !String(entry.effectId).startsWith("action-result:"));
    this.rng = new ProcRandom({ mode: procMode, seed, script: effectScript });
    this.actionResultRng = new ProcRandom({
      mode: procMode,
      seed: (Number(seed) ^ 0x9e3779b9) >>> 0,
      script: actionResultScript,
    });
    this.actionResultResolver = new ActionResultResolver({
      rng: this.actionResultRng,
      emit: (type, payload) => this.#emit(type, payload),
    });
    this.effectRuntime = new EffectRuntime({
      profile: resolvedProfile,
      host: this.#effectHost(),
      rng: this.rng,
    });
    this.aplAdapter = new FeralAPLAdapter(resolvedProfile);
    this.state.status = "running";
    this.effectRuntime.dispatch("on_session_start", { targetCount });
    this.#emit("SESSION_STARTED", {
      reason: "interactive-session-started",
      after: this.#stateSummary(),
      metadata: {
        sessionId: this.state.sessionId,
        profileId: resolvedProfile.id,
        talentCode: resolvedProfile.source.talentCode,
        targetCount,
        procMode: this.rng.mode,
        seed: this.rng.seed,
      },
    });
    this.#updateRecommendation("训练开始");
    return this.getSnapshot();
  }

  resetSession() {
    this.profile = this.resolver.resolve(this.defaultBuildInput);
    this.actionById = this.profile.actionById;
    this.internalActionById = this.profile.internalActionById;
    this.auraDefinitions = Object.fromEntries(this.profile.tracked.auras.map((aura) => [aura.id, aura]));
    this.#initializeState({ targetCount: 1, durationMs: this.profile.session.durationMs });
    this.rng = new ProcRandom({ mode: "seeded", seed: 1210001 });
    this.actionResultRng = new ProcRandom({ mode: "seeded", seed: (1210001 ^ 0x9e3779b9) >>> 0 });
    this.actionResultResolver = new ActionResultResolver({
      rng: this.actionResultRng,
      emit: (type, payload) => this.#emit(type, payload),
    });
    this.effectRuntime = new EffectRuntime({ profile: this.profile, host: this.#effectHost(), rng: this.rng });
    this.aplAdapter = new FeralAPLAdapter(this.profile);
    this.effectRuntime.dispatch("on_session_start", { targetCount: 1 });
    this.recommendation = this.aplAdapter.recommend(this.#aplView());
    return this.getSnapshot();
  }

  #resolveProfile(options) {
    if (options.resolvedProfile) return options.resolvedProfile;
    if (options.buildInput) return this.resolver.resolve(options.buildInput);
    if (options.talentCode) {
      return this.resolver.resolve(
        normalizeBuildInput({
          kind: "talent-code",
          id: options.profileId,
          label: options.profileLabel,
          talentCode: options.talentCode,
          setBonuses: options.setBonuses ?? this.defaultBuildInput.setBonuses,
          source: options.source,
        }),
      );
    }
    return this.resolver.resolve(this.defaultBuildInput);
  }

  #initializeState({ targetCount, durationMs }) {
    this.pendingEvents = [];
    this.eventHistory = [];
    this.recommendation = null;
    this.state = {
      sessionId: `feral-${this.sessionSequence}`,
      status: "idle",
      nowMs: 0,
      durationMs,
      targetCount,
      activeTargetIndex: 0,
      targets: Array.from({ length: targetCount }, (_, index) => ({
        id: `target-${index + 1}`,
        index,
        name: `木桩 ${index + 1}`,
        healthPercent: 100,
        dots: Object.fromEntries(this.profile.tracked.dots.map((dot) => [dot.id, null])),
      })),
      energy: this.profile.resources.energy.initial,
      comboPoints: this.profile.resources.comboPoints.initial,
      gcdReadyAt: 0,
      channel: null,
      scheduledPulses: [],
      dotInstanceSequence: 0,
      mechanics: {},
      cooldownReadyAt: Object.fromEntries(this.profile.actions.map((action) => [action.id, 0])),
      cooldownGroupReadyAt: Object.fromEntries(
        [...new Set(this.profile.actions.map((action) => action.cooldownGroup).filter(Boolean))]
          .map((groupId) => [groupId, 0]),
      ),
      auras: {},
      counters: {},
      nextAutoAttackAt: 0,
      actionCount: 0,
      successfulCasts: 0,
      blockedCasts: 0,
      perfectCasts: 0,
      currentStreak: 0,
      bestStreak: 0,
      actionHistory: [],
      lastSuccessfulActionId: null,
      lastSuccessfulActionKind: null,
      lastGcdActionId: null,
      lastGcdActionKind: null,
    };
    this.state.nextAutoAttackAt = this.#autoAttackIntervalMs();
  }

  pressAction({ skillId, targetIndex = this.state.activeTargetIndex, timestamp } = {}) {
    if (timestamp != null && timestamp > this.state.nowMs) {
      this.advanceTime(timestamp - this.state.nowMs);
    }
    const action = this.actionById[skillId];
    this.#emit("ACTION_REQUESTED", {
      sourceSkillId: skillId ?? null,
      targetIndex,
      before: this.#stateSummary(),
      reason: "user-input",
    });

    const execution = action
      ? this.effectRuntime.resolveActionExecution(action, {
          comboPoints: this.state.comboPoints,
          maxComboPoints: this.profile.resources.comboPoints.max,
        })
      : null;
    const costs = action ? this.#actionCosts(action, execution) : null;
    const actionBlock = this.#actionBlock(action, targetIndex, execution, costs);
    if (actionBlock) {
      this.state.blockedCasts += 1;
      this.#emit("ACTION_BLOCKED", {
        sourceSkillId: skillId ?? null,
        targetIndex,
        before: this.#stateSummary(),
        after: this.#stateSummary(),
        reason: actionBlock.reason,
        metadata: { blockedCode: actionBlock.code },
      });
      return { ok: false, reason: actionBlock.reason, blockedCode: actionBlock.code, snapshot: this.getSnapshot() };
    }

    const recommendationAtCast = clone(this.recommendation);
    const before = this.#stateSummary();
    const effectiveCost = costs.actual;
    const comboSpent = action.comboSpend && execution.consumeCombo ? this.state.comboPoints : 0;
    const effectiveComboPoints = action.comboSpend ? execution.effectiveComboPoints : 0;
    if (effectiveCost) this.#changeEnergy(-effectiveCost, "action-cost", action.id);
    if (action.energyGain) this.#changeEnergy(action.energyGain, "action-gain", action.id);
    if (action.cooldownMs) {
      this.state.cooldownReadyAt[action.id] = this.state.nowMs + action.cooldownMs;
      this.#emit("COOLDOWN_STARTED", {
        sourceSkillId: action.id,
        before: 0,
        after: action.cooldownMs,
        reason: "action-cast",
      });
    }
    if (action.cooldownGroup && action.cooldownGroupMs) {
      this.state.cooldownGroupReadyAt[action.cooldownGroup] =
        this.state.nowMs + action.cooldownGroupMs;
      this.#emit("COOLDOWN_GROUP_STARTED", {
        sourceSkillId: action.id,
        effectId: action.cooldownGroup,
        before: 0,
        after: action.cooldownGroupMs,
        reason: "action-cast",
      });
    }
    if (!action.offGcd) {
      const gcdMs = Math.max(
        750,
        (action.gcdMs ?? this.profile.session.baseGcdMs) / this.#hasteMultiplier(),
      );
      this.state.gcdReadyAt = this.state.nowMs + gcdMs;
    }
    if (action.channel || action.channelMs) {
      const channelDefinition = action.channel ?? {
        durationMs: action.channelMs,
        tickMs: action.channelMs,
        tickCount: 1,
        hasteAffected: false,
      };
      const channelHaste = channelDefinition.hasteAffected ? this.#hasteMultiplier() : 1;
      const channelDurationMs = channelDefinition.durationMs / channelHaste;
      const channelTickMs = channelDefinition.tickMs / channelHaste;
      this.state.channel = {
        skillId: action.id,
        targetIndex,
        startedAt: this.state.nowMs,
        endsAt: this.state.nowMs + channelDurationMs,
        durationMs: channelDurationMs,
        tickIntervalMs: channelTickMs,
        totalTicks: channelDefinition.tickCount,
        ticksCompleted: 0,
        nextTickAt: this.state.nowMs + channelTickMs,
        payload: null,
      };
      this.#emit("CHANNEL_STARTED", {
        sourceSkillId: action.id,
        before: null,
        after: clone(this.state.channel),
        reason: "action-cast",
      });
    }
    const actionResults = this.#resolveActionResults(action, targetIndex, { isProc: false });
    for (const aura of action.auras ?? []) {
      this.#applyAura(aura.auraId, {
        ...aura,
        sourceSkillId: action.id,
        reason: "action-aura",
      });
    }

    if (action.comboSpend) {
      if (comboSpent) this.#changeCombo(-comboSpent, "finisher-spend", action.id);
      this.#applyActionDot(action, targetIndex, effectiveComboPoints);
      this.effectRuntime.dispatch("on_action_impact", {
        action,
        targetIndex,
        comboSpent,
        effectiveComboPoints,
        isProc: false,
        isFree: execution.isFree,
      });
      this.effectRuntime.dispatch("on_action_result", {
        action,
        targetIndex,
        comboSpent,
        effectiveComboPoints,
        isProc: false,
        isFree: execution.isFree,
        ...actionResults,
      });
      this.effectRuntime.dispatch("on_finisher", {
        action,
        targetIndex,
        comboSpent,
        effectiveComboPoints,
        isProc: false,
        isFree: execution.isFree,
      });
    } else {
      if (action.comboGain) this.#changeCombo(action.comboGain, "builder-gain", action.id);
      if (!action.resourcePulses?.applyDotOnPulse) this.#applyActionDot(action, targetIndex, null);
      this.effectRuntime.dispatch("on_action_impact", {
        action,
        targetIndex,
        comboSpent,
        effectiveComboPoints,
        isProc: false,
        isFree: execution.isFree,
      });
      this.effectRuntime.dispatch("on_action_result", {
        action,
        targetIndex,
        comboSpent,
        effectiveComboPoints,
        isProc: false,
        isFree: execution.isFree,
        ...actionResults,
      });
      if (action.kind === "builder") {
        this.effectRuntime.dispatch("on_builder", {
          action,
          targetIndex,
          ...actionResults,
          comboGained: action.comboGain ?? 0,
          isProc: false,
          isFree: execution.isFree,
        });
      }
    }
    this.effectRuntime.dispatch("on_action_cast", { action, targetIndex, comboSpent, effectiveComboPoints, effectiveCost, isProc: false, isFree: execution.isFree });
    if (this.state.channel?.skillId === action.id) {
      this.effectRuntime.dispatch("on_channel_start", { action, targetIndex, channel: this.state.channel, isProc: false, isFree: execution.isFree });
    }
    this.#scheduleActionPulses(action, targetIndex, { originSkillId: action.id });

    this.state.actionCount += 1;
    this.state.successfulCasts += 1;
    const verdict = this.#scoreAction(action.id, targetIndex, recommendationAtCast);
    if (verdict === "perfect") {
      this.state.perfectCasts += 1;
      this.state.currentStreak += 1;
      this.state.bestStreak = Math.max(this.state.bestStreak, this.state.currentStreak);
    } else {
      this.state.currentStreak = 0;
    }
    this.state.lastSuccessfulActionId = action.id;
    this.state.lastSuccessfulActionKind = action.kind;
    if (!action.offGcd) {
      this.state.lastGcdActionId = action.id;
      this.state.lastGcdActionKind = action.kind;
    }
    const historyEntry = {
      timeMs: this.state.nowMs,
      skillId: action.id,
      targetIndex,
      before,
      after: this.#stateSummary(),
      recommendation: recommendationAtCast,
      verdict,
    };
    this.state.actionHistory.push(historyEntry);
    this.#emit("ACTION_CAST", {
      sourceSkillId: action.id,
      targetIndex,
      before,
      after: historyEntry.after,
      reason: verdict,
      ruleId: recommendationAtCast?.ruleId ?? null,
      metadata: { comboSpent, effectiveComboPoints, effectiveCost, isFree: execution.isFree },
    });
    this.#updateRecommendation(`${action.name}已施放`);
    return { ok: true, event: clone(historyEntry), snapshot: this.getSnapshot() };
  }

  #actionBlock(action, targetIndex, execution, costs) {
    if (!action) return { code: "build-unavailable", reason: "当前构筑未启用该技能" };
    if (this.state.status !== "running") return { code: "session-inactive", reason: "训练尚未开始或已经结束" };
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.state.targetCount) {
      return { code: "invalid-target", reason: "目标不存在" };
    }
    if (this.state.channel && this.state.channel.endsAt > this.state.nowMs) {
      return { code: "channel-active", reason: "正在引导其他技能" };
    }
    if (!action.offGcd && this.state.gcdReadyAt > this.state.nowMs + EPSILON) {
      return { code: "global-cooldown", reason: "公共冷却尚未结束" };
    }
    if ((this.state.cooldownReadyAt[action.id] ?? 0) > this.state.nowMs + EPSILON) {
      return { code: "cooldown", reason: "技能冷却中" };
    }
    if (
      action.cooldownGroup &&
      (this.state.cooldownGroupReadyAt[action.cooldownGroup] ?? 0) > this.state.nowMs + EPSILON
    ) {
      return { code: "shared-cooldown", reason: "共享物品冷却中" };
    }
    if (action.comboSpend && this.state.comboPoints < execution.minimumComboPoints) {
      return { code: "combo-points", reason: `至少需要 ${execution.minimumComboPoints} 个连击点` };
    }
    if (costs.minimum > this.state.energy + EPSILON) return { code: "energy", reason: "能量不足" };
    return null;
  }

  #actionCosts(action, execution = null) {
    const resolvedExecution = execution ?? this.effectRuntime.resolveActionExecution(action, {
      comboPoints: this.state.comboPoints,
      maxComboPoints: this.profile.resources.comboPoints.max,
    });
    const minimum = resolvedExecution.isFree
      ? 0
      : this.effectRuntime.modifyActionCost(action, action?.cost ?? 0);
    const extra = resolvedExecution.isFree || !action.extraCost
      ? 0
      : this.effectRuntime.modifyActionCost(action, action.extraCost.max ?? 0);
    const maximum = minimum + extra;
    return {
      minimum,
      maximum,
      recommended: action.poolToMaxCost ? maximum : minimum,
      actual: action.poolToMaxCost ? Math.min(maximum, this.state.energy) : minimum,
      execution: resolvedExecution,
    };
  }

  #applyActionDot(action, targetIndex, comboSpent) {
    if (!action.dot) return;
    const durationMs = action.dot.durationFormula
      ? action.dot.durationFormula.baseMs *
        ((comboSpent ?? 1) + action.dot.durationFormula.comboOffset) *
        (action.dot.durationFormula.multiplier ?? 1)
      : action.dot.durationMs;
    const targetIndices = action.dot.targetMode === "all"
      ? this.state.targets.map((target) => target.index)
      : [targetIndex];
    const periodMs = action.dot.hasteAffected === false
      ? action.dot.periodMs
      : action.dot.periodMs / this.#hasteMultiplier();
    for (const index of targetIndices) {
      this.#applyDot(action.dot.id, index, {
        durationMs,
        periodMs,
        sourceSkillId: action.id,
        refreshMode: action.dot.refreshMode,
        stackingMode: action.dot.stackingMode,
        maxStacks: action.dot.maxStacks,
      });
    }
  }

  #applyDot(dotId, targetIndex, {
    durationMs,
    periodMs,
    sourceSkillId,
    refreshMode = "pandemic",
    stackingMode = "refresh",
    maxStacks = 1,
  }) {
    const target = this.state.targets[targetIndex];
    const existing = target.dots[dotId] ?? null;
    const before = existing ? this.#dotSnapshot(existing) : null;
    if (stackingMode === "independent") {
      const dot = existing ?? {
        id: dotId,
        sourceSkillId,
        targetIndex,
        stackingMode,
        maxStacks,
        instances: [],
        refreshCount: 0,
        refreshMode: "independent",
        pandemicThresholdMs: 0,
        pandemicAnnounced: true,
      };
      if (dot.instances.length >= maxStacks) {
        dot.instances.sort((left, right) => left.expiresAt - right.expiresAt || left.instanceId - right.instanceId);
        dot.instances.shift();
      }
      dot.instances.push({
        instanceId: ++this.state.dotInstanceSequence,
        sourceSkillId,
        appliedAt: this.state.nowMs,
        expiresAt: this.state.nowMs + durationMs,
        baseDurationMs: durationMs,
        periodMs,
        nextTickAt: this.state.nowMs + periodMs,
        tickCount: 0,
      });
      this.#syncIndependentDot(dot);
      target.dots[dotId] = dot;
      this.#emit(existing ? "DOT_STACK_ADDED" : "DOT_APPLIED", {
        sourceSkillId,
        targetIndex,
        effectId: dotId,
        before,
        after: this.#dotSnapshot(dot),
        reason: existing ? "independent-stack" : "independent-dot",
        metadata: { stackingMode, maxStacks },
      });
      this.#dispatchDotStateChange({ dotId, targetIndex, sourceSkillId, before, after: this.#dotSnapshot(dot) });
      return;
    }
    const pandemicThresholdMs = durationMs * 0.3;
    const remainingMs = existing ? Math.max(0, existing.expiresAt - this.state.nowMs) : 0;
    const carryMs = existing && refreshMode === "pandemic" ? Math.min(remainingMs, pandemicThresholdMs) : 0;
    const dot = {
      id: dotId,
      sourceSkillId,
      targetIndex,
      appliedAt: this.state.nowMs,
      expiresAt: this.state.nowMs + durationMs + carryMs,
      baseDurationMs: durationMs,
      pandemicThresholdMs,
      periodMs,
      nextTickAt: this.state.nowMs + periodMs,
      stacks: 1,
      refreshCount: (existing?.refreshCount ?? 0) + (existing ? 1 : 0),
      refreshMode,
      stackingMode,
      maxStacks,
      pandemicAnnounced: false,
    };
    target.dots[dotId] = dot;
    this.#emit(existing ? "DOT_REFRESHED" : "DOT_APPLIED", {
      sourceSkillId,
      targetIndex,
      effectId: dotId,
      before,
      after: this.#dotSnapshot(dot),
      reason: existing ? "pandemic-refresh" : "action-dot",
      metadata: { carriedMs: carryMs },
    });
    this.#dispatchDotStateChange({ dotId, targetIndex, sourceSkillId, before, after: this.#dotSnapshot(dot) });
  }

  #syncIndependentDot(dot) {
    dot.instances.sort((left, right) => left.expiresAt - right.expiresAt || left.instanceId - right.instanceId);
    const latest = dot.instances.reduce(
      (current, instance) => !current || instance.appliedAt >= current.appliedAt ? instance : current,
      null,
    );
    dot.stacks = dot.instances.length;
    dot.sourceSkillId = latest?.sourceSkillId ?? dot.sourceSkillId;
    dot.appliedAt = Math.min(...dot.instances.map((instance) => instance.appliedAt));
    dot.expiresAt = Math.max(...dot.instances.map((instance) => instance.expiresAt));
    dot.baseDurationMs = latest?.baseDurationMs ?? 0;
    dot.periodMs = latest?.periodMs ?? 0;
    dot.nextTickAt = Math.min(...dot.instances.map((instance) => instance.nextTickAt));
  }

  #dispatchDotStateChange({ dotId, targetIndex, sourceSkillId, before, after }) {
    this.effectRuntime.dispatch("on_dot_state_change", {
      sourceSkillId,
      targetIndex,
      dotId,
      before,
      after,
      beforeStacks: before?.stacks ?? 0,
      afterStacks: after?.stacks ?? 0,
    });
  }

  advanceTime(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("advanceTime 需要非负毫秒数");
    const endAt = Math.min(this.state.durationMs, this.state.nowMs + milliseconds);
    while (this.state.nowMs < endAt - EPSILON && this.state.status !== "ended") {
      const nextAt = this.#nextScheduledTime(endAt);
      this.#regenerateEnergy(nextAt - this.state.nowMs);
      this.state.nowMs = nextAt;
      this.#processScheduledEvents();
    }
    if (this.state.nowMs >= this.state.durationMs - EPSILON && this.state.status !== "ended") {
      this.state.status = "ended";
      this.#emit("SESSION_ENDED", {
        reason: "duration-complete",
        after: this.#stateSummary(),
      });
    }
    this.#updateRecommendation("时间推进");
    return this.getSnapshot();
  }

  #nextScheduledTime(endAt) {
    const candidates = [endAt, this.state.durationMs, this.state.nextAutoAttackAt];
    if (this.state.channel) {
      candidates.push(this.state.channel.endsAt);
      if (this.state.channel.nextTickAt > this.state.nowMs + EPSILON) candidates.push(this.state.channel.nextTickAt);
    }
    for (const pulse of this.state.scheduledPulses) {
      if (pulse.executeAt > this.state.nowMs + EPSILON) candidates.push(pulse.executeAt);
    }
    for (const readyAt of Object.values(this.state.cooldownReadyAt)) if (readyAt > this.state.nowMs + EPSILON) candidates.push(readyAt);
    for (const readyAt of Object.values(this.state.cooldownGroupReadyAt)) if (readyAt > this.state.nowMs + EPSILON) candidates.push(readyAt);
    for (const aura of Object.values(this.state.auras)) {
      if (aura.expiresAt > this.state.nowMs + EPSILON) candidates.push(aura.expiresAt);
      for (const expiresAt of aura.stackExpiries ?? []) {
        if (expiresAt > this.state.nowMs + EPSILON) candidates.push(expiresAt);
      }
      if (aura.nextTickAt > this.state.nowMs + EPSILON) candidates.push(aura.nextTickAt);
    }
    for (const target of this.state.targets) {
      for (const dot of Object.values(target.dots)) {
        if (!dot) continue;
        if (dot.stackingMode === "independent") {
          for (const instance of dot.instances) {
            if (instance.nextTickAt > this.state.nowMs + EPSILON) candidates.push(instance.nextTickAt);
            if (instance.expiresAt > this.state.nowMs + EPSILON) candidates.push(instance.expiresAt);
          }
          continue;
        }
        if (dot.nextTickAt > this.state.nowMs + EPSILON) candidates.push(dot.nextTickAt);
        if (dot.expiresAt > this.state.nowMs + EPSILON) candidates.push(dot.expiresAt);
        const pandemicAt = dot.expiresAt - dot.pandemicThresholdMs;
        if (!dot.pandemicAnnounced && pandemicAt > this.state.nowMs + EPSILON) candidates.push(pandemicAt);
      }
    }
    return Math.min(...candidates.filter((candidate) => candidate >= this.state.nowMs - EPSILON));
  }

  #processScheduledEvents() {
    const now = this.state.nowMs;
    if (this.state.nextAutoAttackAt <= now + EPSILON) {
      this.effectRuntime.dispatch("on_auto_attack", {
        sourceSkillId: "autoAttack",
        intervalMs: this.#autoAttackIntervalMs(),
      });
      this.state.nextAutoAttackAt += this.#autoAttackIntervalMs();
    }
    for (const [skillId, readyAt] of Object.entries(this.state.cooldownReadyAt)) {
      if (readyAt > 0 && readyAt <= now + EPSILON) {
        this.state.cooldownReadyAt[skillId] = 0;
        this.#emit("COOLDOWN_READY", { sourceSkillId: skillId, before: readyAt, after: 0, reason: "cooldown-complete" });
      }
    }
    for (const [groupId, readyAt] of Object.entries(this.state.cooldownGroupReadyAt)) {
      if (readyAt > 0 && readyAt <= now + EPSILON) {
        this.state.cooldownGroupReadyAt[groupId] = 0;
        this.#emit("COOLDOWN_GROUP_READY", {
          effectId: groupId,
          before: readyAt,
          after: 0,
          reason: "shared-cooldown-complete",
        });
      }
    }

    const duePulses = this.state.scheduledPulses
      .filter((pulse) => pulse.executeAt <= now + EPSILON)
      .sort((left, right) => left.executeAt - right.executeAt || left.sequence - right.sequence);
    this.state.scheduledPulses = this.state.scheduledPulses.filter((pulse) => pulse.executeAt > now + EPSILON);
    for (const pulse of duePulses) this.#executeActionPulse(pulse);

    if (this.state.channel) {
      const channel = this.state.channel;
      while (
        channel.ticksCompleted < channel.totalTicks &&
        channel.nextTickAt <= now + EPSILON &&
        channel.nextTickAt <= channel.endsAt + EPSILON
      ) {
        channel.ticksCompleted += 1;
        const tickAt = channel.nextTickAt;
        channel.nextTickAt += channel.tickIntervalMs;
        const action = this.actionById[channel.skillId];
        this.#emit("CHANNEL_TICK", {
          sourceSkillId: channel.skillId,
          targetIndex: channel.targetIndex,
          reason: "periodic-channel-tick",
          metadata: { tickAt, tick: channel.ticksCompleted, totalTicks: channel.totalTicks },
        });
        this.effectRuntime.dispatch("on_channel_tick", {
          action,
          targetIndex: channel.targetIndex,
          channel,
          tick: channel.ticksCompleted,
          totalTicks: channel.totalTicks,
          isProc: false,
          isFree: false,
        });
      }
    }
    if (this.state.channel && this.state.channel.endsAt <= now + EPSILON) {
      const channel = this.state.channel;
      this.state.channel = null;
      const action = this.actionById[channel.skillId];
      this.#emit("CHANNEL_COMPLETED", {
        sourceSkillId: channel.skillId,
        before: channel,
        after: null,
        reason: "channel-complete",
      });
      this.effectRuntime.dispatch("on_channel_complete", {
        action,
        targetIndex: channel.targetIndex,
        channel,
        isProc: false,
        isFree: false,
      });
    }

    for (const aura of Object.values(this.state.auras)) {
      if (aura.stackingMode !== "independent") continue;
      const before = this.#auraSnapshot(aura);
      const remainingExpiries = aura.stackExpiries.filter((expiresAt) => expiresAt > now + EPSILON);
      if (remainingExpiries.length === aura.stackExpiries.length) continue;
      if (!remainingExpiries.length) {
        delete this.state.auras[aura.id];
        this.#emit("AURA_EXPIRED", {
          sourceSkillId: aura.sourceSkillId,
          effectId: aura.id,
          before,
          after: null,
          reason: "independent-stacks-expired",
        });
        continue;
      }
      aura.stackExpiries = remainingExpiries;
      aura.stacks = remainingExpiries.length;
      aura.expiresAt = Math.max(...remainingExpiries);
      this.#emit("AURA_STACK_CHANGED", {
        sourceSkillId: aura.sourceSkillId,
        effectId: aura.id,
        before,
        after: this.#auraSnapshot(aura),
        reason: "independent-stack-expired",
      });
    }

    for (const aura of Object.values(this.state.auras)) {
      while (
        aura.periodMs > 0 &&
        aura.nextTickAt <= now + EPSILON &&
        aura.nextTickAt <= aura.expiresAt + EPSILON
      ) {
        const tickAt = aura.nextTickAt;
        aura.tickCount += 1;
        aura.nextTickAt += aura.periodMs;
        this.#emit("AURA_TICK", {
          sourceSkillId: aura.sourceSkillId,
          effectId: aura.id,
          reason: "periodic-aura-tick",
          metadata: { tickAt, tick: aura.tickCount },
        });
        this.effectRuntime.dispatch("on_aura_tick", {
          auraId: aura.id,
          sourceSkillId: aura.sourceSkillId,
          tick: aura.tickCount,
        });
      }
    }

    const expiredAuraIds = Object.values(this.state.auras)
      .filter((aura) => aura.expiresAt <= now + EPSILON)
      .map((aura) => aura.id);
    for (const auraId of expiredAuraIds) {
      this.effectRuntime.dispatch("on_aura_expire", { auraId });
      this.#expireAura(auraId, "duration-expired");
    }

    for (const target of this.state.targets) {
      for (const [dotId, dot] of Object.entries(target.dots)) {
        if (!dot) continue;
        if (dot.stackingMode === "independent") {
          this.#processIndependentDot(target, dotId, dot, now);
          continue;
        }
        while (dot.nextTickAt <= now + EPSILON && dot.nextTickAt < dot.expiresAt - EPSILON) {
          const tickAt = dot.nextTickAt;
          dot.nextTickAt += dot.periodMs;
          this.#emit("DOT_TICK", {
            sourceSkillId: dot.sourceSkillId,
            targetIndex: target.index,
            effectId: dotId,
            reason: "periodic-tick",
            metadata: { tickAt, damageMode: "not-calculated" },
          });
          this.effectRuntime.dispatch("on_dot_tick", {
            sourceSkillId: dot.sourceSkillId,
            targetIndex: target.index,
            dotId,
          });
        }
        if (!dot.pandemicAnnounced && dot.expiresAt - dot.pandemicThresholdMs <= now + EPSILON) {
          dot.pandemicAnnounced = true;
          this.#emit("DOT_PANDEMIC", {
            sourceSkillId: dot.sourceSkillId,
            targetIndex: target.index,
            effectId: dotId,
            before: this.#dotSnapshot(dot),
            after: this.#dotSnapshot(dot),
            reason: "pandemic-window",
          });
        }
        if (dot.expiresAt <= now + EPSILON) {
          const before = this.#dotSnapshot(dot);
          target.dots[dotId] = null;
          this.#emit("DOT_EXPIRED", {
            sourceSkillId: dot.sourceSkillId,
            targetIndex: target.index,
            effectId: dotId,
            before,
            after: null,
            reason: "duration-expired",
          });
          this.#dispatchDotStateChange({
            dotId,
            targetIndex: target.index,
            sourceSkillId: dot.sourceSkillId,
            before,
            after: null,
          });
        }
      }
    }
  }

  #processIndependentDot(target, dotId, dot, now) {
    for (const instance of dot.instances) {
      while (
        instance.nextTickAt <= now + EPSILON &&
        instance.nextTickAt <= instance.expiresAt + EPSILON
      ) {
        const tickAt = instance.nextTickAt;
        instance.tickCount += 1;
        instance.nextTickAt += instance.periodMs;
        this.#emit("DOT_TICK", {
          sourceSkillId: instance.sourceSkillId,
          targetIndex: target.index,
          effectId: dotId,
          reason: "independent-periodic-tick",
          metadata: {
            tickAt,
            instanceId: instance.instanceId,
            stackCount: dot.instances.length,
            damageMode: "not-calculated",
          },
        });
        this.effectRuntime.dispatch("on_dot_tick", {
          sourceSkillId: instance.sourceSkillId,
          targetIndex: target.index,
          dotId,
          dotInstanceId: instance.instanceId,
        });
      }
    }

    const expired = dot.instances
      .filter((instance) => instance.expiresAt <= now + EPSILON)
      .sort((left, right) => left.expiresAt - right.expiresAt || left.instanceId - right.instanceId);
    for (const instance of expired) {
      const before = this.#dotSnapshot(dot);
      dot.instances = dot.instances.filter((entry) => entry.instanceId !== instance.instanceId);
      if (dot.instances.length > 0) {
        this.#syncIndependentDot(dot);
        const after = this.#dotSnapshot(dot);
        this.#emit("DOT_STACK_EXPIRED", {
          sourceSkillId: instance.sourceSkillId,
          targetIndex: target.index,
          effectId: dotId,
          before,
          after,
          reason: "independent-stack-expired",
          metadata: { instanceId: instance.instanceId },
        });
        this.#dispatchDotStateChange({
          dotId,
          targetIndex: target.index,
          sourceSkillId: instance.sourceSkillId,
          before,
          after,
        });
      } else {
        target.dots[dotId] = null;
        this.#emit("DOT_EXPIRED", {
          sourceSkillId: instance.sourceSkillId,
          targetIndex: target.index,
          effectId: dotId,
          before,
          after: null,
          reason: "duration-expired",
          metadata: { instanceId: instance.instanceId, stackingMode: "independent" },
        });
        this.#dispatchDotStateChange({
          dotId,
          targetIndex: target.index,
          sourceSkillId: instance.sourceSkillId,
          before,
          after: null,
        });
      }
    }
  }

  #executeInternalAction(actionId, targetIndex, metadata = {}) {
    const action = this.internalActionById[actionId];
    if (!action) throw new Error(`ResolvedProfile does not contain internal action '${actionId}'`);
    if (targetIndex != null && (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.state.targetCount)) {
      throw new Error(`Internal action '${actionId}' selected an invalid target`);
    }

    const before = this.#stateSummary();
    const comboSpent = 0;
    const effectiveComboPoints = action.effectiveComboPoints ?? 0;
    if (action.comboGain) this.#changeCombo(action.comboGain, "internal-builder-gain", action.id);
    if (action.dot && !action.resourcePulses?.applyDotOnPulse && targetIndex != null) {
      this.#applyActionDot(action, targetIndex, null);
    }
    const actionResults = this.#resolveActionResults(action, targetIndex, { isProc: true });
    this.effectRuntime.dispatch("on_action_impact", {
      action,
      targetIndex,
      comboSpent,
      effectiveComboPoints,
      isProc: true,
      isFree: true,
      originSkillId: metadata.originSkillId,
    });
    this.effectRuntime.dispatch("on_action_result", {
      action,
      targetIndex,
      comboSpent,
      effectiveComboPoints,
      isProc: true,
      isFree: true,
      originSkillId: metadata.originSkillId,
      ...actionResults,
    });
    if (action.kind === "builder") {
      this.effectRuntime.dispatch("on_builder", {
        action,
        targetIndex,
        ...actionResults,
        comboGained: action.comboGain ?? 0,
        isProc: true,
        isFree: true,
        originSkillId: metadata.originSkillId,
      });
    }
    if (action.kind === "finisher") {
      this.effectRuntime.dispatch("on_finisher", {
        action,
        targetIndex,
        comboSpent,
        effectiveComboPoints,
        isProc: true,
        isFree: true,
        originSkillId: metadata.originSkillId,
      });
    }
    this.effectRuntime.dispatch("on_action_cast", {
      action,
      targetIndex,
      comboSpent,
      effectiveComboPoints,
      effectiveCost: 0,
      isProc: true,
      isFree: true,
      originSkillId: metadata.originSkillId,
    });
    this.#scheduleActionPulses(action, targetIndex, metadata);

    this.#emit("INTERNAL_ACTION_CAST", {
      sourceSkillId: action.id,
      targetIndex,
      before,
      after: this.#stateSummary(),
      reason: "secondary-action",
      metadata: {
        ...metadata,
        isProc: true,
        isFree: true,
        comboSpent,
        effectiveComboPoints,
      },
    });
  }

  #scheduleActionPulses(action, targetIndex, metadata = {}) {
    const definition = action.resourcePulses;
    if (!definition) return;
    for (let index = 0; index < definition.count; index += 1) {
      this.state.scheduledPulses.push({
        sequence: index,
        actionId: action.id,
        targetIndex,
        executeAt: this.state.nowMs + definition.firstDelayMs + definition.intervalMs * index,
        resource: definition.resource,
        amount: definition.amount,
        applyDotOnPulse: Boolean(definition.applyDotOnPulse),
        internal: Boolean(action.internal),
        originSkillId: metadata.originSkillId,
      });
    }
  }

  #executeActionPulse(pulse) {
    const action = this.internalActionById[pulse.actionId] ?? this.actionById[pulse.actionId];
    if (!action) return;
    if (pulse.resource === "comboPoints") {
      this.#changeCombo(pulse.amount, "internal-resource-pulse", action.id);
    } else if (pulse.resource === "energy") {
      this.#changeEnergy(pulse.amount, "internal-resource-pulse", action.id);
    } else {
      throw new Error(`Unsupported action pulse resource '${pulse.resource}'`);
    }
    if (pulse.applyDotOnPulse && action.dot && pulse.targetIndex != null) {
      this.#applyActionDot(action, pulse.targetIndex, null);
    }
    this.#emit(pulse.internal ? "INTERNAL_ACTION_PULSE" : "ACTION_RESOURCE_PULSE", {
      sourceSkillId: action.id,
      targetIndex: pulse.targetIndex,
      reason: "secondary-action-pulse",
      metadata: {
        originSkillId: pulse.originSkillId,
        resource: pulse.resource,
        amount: pulse.amount,
        sequence: pulse.sequence + 1,
        total: action.resourcePulses.count,
      },
    });
  }

  #regenerateEnergy(elapsedMs) {
    if (elapsedMs <= 0) return;
    const amount = this.#energyRegenPerSecond() * (elapsedMs / 1000);
    this.#changeEnergy(amount, "passive-regeneration", null, false);
  }

  #energyRegenPerSecond() {
    let multiplier = this.#hasteMultiplier();
    for (const aura of Object.values(this.state.auras)) {
      const definition = this.auraDefinitions[aura.id];
      if (definition?.energyRegenPercent) multiplier *= 1 + definition.energyRegenPercent / 100;
    }
    return this.profile.resources.energy.regenPerSecond * multiplier;
  }

  #hasteMultiplier() {
    let multiplier = Number(this.#currentCombatStats().hasteMultiplier ?? 1);
    for (const aura of Object.values(this.state.auras)) {
      const definition = this.auraDefinitions[aura.id];
      if (definition?.hastePercent) multiplier *= 1 + definition.hastePercent / 100;
    }
    return multiplier;
  }

  #autoAttackIntervalMs() {
    return 2000 / this.#hasteMultiplier();
  }

  #actionProducesResult(action) {
    if (action.resultModel?.enabled != null) return action.resultModel.enabled;
    return ["builder", "finisher", "proc"].includes(action.kind) || Boolean(action.dot);
  }

  #resolveActionResults(action, targetIndex, { isProc }) {
    if (!this.#actionProducesResult(action)) {
      return { hitCount: 0, critCount: 0, anyCrit: false, allCrit: false, results: [] };
    }
    const targetIndices = action.targetMode === "all"
      ? this.state.targets.map((target) => target.index)
      : [targetIndex];
    return this.actionResultResolver.resolve({
      action,
      targetIndices,
      critChance: this.#actionCritChance(action),
      timestamp: this.state.nowMs,
      actionCount: this.state.actionCount,
      isProc,
    });
  }

  #actionCritChance(action) {
    let chance = this.#currentCombatStats().critChance;
    for (const aura of Object.values(this.state.auras)) {
      const definition = this.auraDefinitions[aura.id];
      if (!definition?.critChanceFlat) continue;
      if (definition.affectedActionIds && !definition.affectedActionIds.includes(action.id)) continue;
      chance += definition.critChanceFlat;
    }
    return clamp(this.effectRuntime.modifyActionCritChance(action, chance), 0, 1);
  }

  setActiveTarget(targetIndex) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.state.targetCount) throw new Error("目标不存在。");
    const before = this.state.activeTargetIndex;
    this.state.activeTargetIndex = targetIndex;
    if (before !== targetIndex) {
      this.#emit("TARGET_CHANGED", { targetIndex, before, after: targetIndex, reason: "user-selection" });
      this.#updateRecommendation("当前目标已切换");
    }
    return this.getSnapshot();
  }

  getRecommendation() {
    return clone(this.recommendation);
  }

  #updateRecommendation(changedBecause) {
    const next = this.aplAdapter.recommend(this.#aplView());
    const previous = this.recommendation;
    next.previous = previous
      ? { skillId: previous.skillId, targetIndex: previous.targetIndex, ruleId: previous.ruleId }
      : null;
    next.changedBecause = changedBecause;
    const changed = !previous || previous.skillId !== next.skillId || previous.targetIndex !== next.targetIndex || previous.ruleId !== next.ruleId;
    this.recommendation = next;
    if (changed) {
      this.#emit("RECOMMENDATION_CHANGED", {
        sourceSkillId: next.skillId,
        targetIndex: next.targetIndex,
        before: previous,
        after: next,
        reason: changedBecause,
        ruleId: next.ruleId,
      });
    }
  }

  #aplView() {
    return {
      status: this.state.status,
      nowMs: this.state.nowMs,
      targetCount: this.state.targetCount,
      activeTargetIndex: this.state.activeTargetIndex,
      targets: this.state.targets,
      energy: this.state.energy,
      maxEnergy: this.profile.resources.energy.max,
      comboPoints: this.state.comboPoints,
      channel: this.state.channel,
      lastSuccessfulActionKind: this.state.lastSuccessfulActionKind,
      lastGcdActionId: this.state.lastGcdActionId,
      lastGcdActionKind: this.state.lastGcdActionKind,
      fightRemainingMs: Math.max(0, this.state.durationMs - this.state.nowMs),
      energyRegenPerSecond: this.#energyRegenPerSecond(),
      hasAura: (auraId) => this.#hasAura(auraId),
      auraRemaining: (auraId) => this.#auraRemaining(auraId),
      cooldownRemaining: (actionId) => this.#cooldownRemaining(actionId),
      dotRemaining: (dot) => this.#dotRemaining(dot),
      dotRefreshable: (dot) => this.#dotRefreshable(dot),
      effectiveCost: (action) => this.#actionCosts(action).recommended,
    };
  }

  #scoreAction(skillId, targetIndex, recommendation) {
    if (!recommendation?.skillId) return "alternate";
    if (skillId !== recommendation.skillId) return "alternate";
    if (recommendation.targetIndex != null && targetIndex !== recommendation.targetIndex) return "wrong-target";
    return "perfect";
  }

  #effectHost() {
    return {
      now: () => this.state.nowMs,
      actionCount: () => this.state.actionCount,
      hasAura: (auraId) => this.#hasAura(auraId),
      auraStacks: (auraId) => this.state.auras[auraId]?.stacks ?? 0,
      applyAura: (auraId, options) => this.#applyAura(auraId, options),
      consumeAura: (auraId, stacks, sourceSkillId) => this.#consumeAura(auraId, stacks, sourceSkillId),
      changeEnergy: (amount, reason, sourceSkillId) => this.#changeEnergy(amount, reason, sourceSkillId),
      changeCombo: (amount, reason, sourceSkillId, options) => this.#changeCombo(amount, reason, sourceSkillId, options),
      getCounter: (counterId) => this.state.counters[counterId] ?? 0,
      addCounter: (counterId, amount, reason, sourceSkillId) => this.#addCounter(counterId, amount, reason, sourceSkillId),
      resetCounter: (counterId, reason, sourceSkillId) => this.#resetCounter(counterId, reason, sourceSkillId),
      targetCount: () => this.state.targetCount,
      activeTargetIndex: () => this.state.activeTargetIndex,
      hasDot: (targetIndex, dotId) => Boolean(
        this.state.targets[targetIndex]?.dots[dotId]?.expiresAt > this.state.nowMs + EPSILON
      ),
      activeDotCount: (dotId) => this.state.targets.filter(
        (target) => target.dots[dotId]?.expiresAt > this.state.nowMs + EPSILON,
      ).length,
      activeDotStacks: (dotId) => this.state.targets.reduce((total, target) => {
        const dot = target.dots[dotId];
        if (!dot) return total;
        if (dot.stackingMode === "independent") {
          return total + dot.instances.filter(
            (instance) => instance.expiresAt > this.state.nowMs + EPSILON,
          ).length;
        }
        return total + (dot.expiresAt > this.state.nowMs + EPSILON ? dot.stacks ?? 1 : 0);
      }, 0),
      activeDotMaxRemaining: (dotId) => this.state.targets.reduce((maximum, target) => {
        const dot = target.dots[dotId];
        if (!dot) return maximum;
        const expiresAt = dot.stackingMode === "independent"
          ? Math.max(
              0,
              ...dot.instances
                .filter((instance) => instance.expiresAt > this.state.nowMs + EPSILON)
                .map((instance) => instance.expiresAt),
            )
          : dot.expiresAt;
        return Math.max(maximum, expiresAt - this.state.nowMs);
      }, 0),
      selectTarget: (selector, context) => this.#selectEffectTarget(selector, context),
      executeInternalAction: (actionId, targetIndex, metadata) => this.#executeInternalAction(actionId, targetIndex, metadata),
      getMechanicState: (mechanicId) => this.state.mechanics[mechanicId] ?? null,
      setMechanicState: (mechanicId, value) => {
        this.state.mechanics[mechanicId] = value;
      },
      emit: (type, payload) => this.#emit(type, payload),
    };
  }

  #selectEffectTarget(selector, context) {
    const sourceTargetIndex = Number.isInteger(context.targetIndex)
      ? context.targetIndex
      : this.state.activeTargetIndex;
    if (selector === "context") return sourceTargetIndex;
    if (selector === "active") return this.state.activeTargetIndex;
    if (selector?.kind === "inactive_dot_else_source") {
      const candidate = this.state.targets.find(
        (target) =>
          (!selector.excludeSource || target.index !== sourceTargetIndex) &&
          !this.#dotActive(target.dots[selector.dotId]),
      );
      return candidate?.index ?? sourceTargetIndex;
    }
    throw new Error(`Unsupported effect target selector '${JSON.stringify(selector)}'`);
  }

  #dotActive(dot) {
    return Boolean(dot?.expiresAt > this.state.nowMs + EPSILON);
  }

  #applyAura(auraId, { durationMs, periodMs = 0, stacks = 1, maxStacks = 1, replaceStacks = true, refreshMode = "refresh", stackingMode = "refresh", sourceSkillId = null, reason = "aura-refresh" }) {
    if (!(durationMs > 0)) return null;
    const existing = this.state.auras[auraId];
    const before = existing ? this.#auraSnapshot(existing) : null;
    if (stackingMode === "independent") {
      const stackExpiries = [...(existing?.stackExpiries ?? [])];
      const addedStacks = Math.min(Math.max(0, stacks), Math.max(0, maxStacks - stackExpiries.length));
      for (let index = 0; index < addedStacks; index += 1) {
        stackExpiries.push(this.state.nowMs + durationMs);
      }
      if (!stackExpiries.length) return existing ?? null;
      stackExpiries.sort((left, right) => left - right);
      const aura = {
        id: auraId,
        stacks: stackExpiries.length,
        maxStacks,
        stackingMode,
        stackExpiries,
        sourceSkillId,
        appliedAt: existing?.appliedAt ?? this.state.nowMs,
        refreshedAt: this.state.nowMs,
        expiresAt: Math.max(...stackExpiries),
        periodMs: 0,
        nextTickAt: 0,
        tickCount: 0,
      };
      this.state.auras[auraId] = aura;
      this.#emit(existing ? "AURA_STACK_CHANGED" : "AURA_APPLIED", {
        sourceSkillId,
        effectId: auraId,
        before,
        after: this.#auraSnapshot(aura),
        reason,
      });
      return aura;
    }
    const nextStacks = replaceStacks
      ? stacks
      : Math.min(maxStacks, (existing?.stacks ?? 0) + stacks);
    const aura = {
      id: auraId,
      stacks: clamp(nextStacks, 1, maxStacks),
      maxStacks,
      stackingMode,
      sourceSkillId,
      appliedAt: existing?.appliedAt ?? this.state.nowMs,
      refreshedAt: this.state.nowMs,
      expiresAt: refreshMode === "extend" && existing
        ? existing.expiresAt + durationMs
        : this.state.nowMs + durationMs,
      periodMs,
      nextTickAt: periodMs > 0 ? this.state.nowMs + periodMs : 0,
      tickCount: 0,
    };
    this.state.auras[auraId] = aura;
    this.#emit(existing ? "AURA_REFRESHED" : "AURA_APPLIED", {
      sourceSkillId,
      effectId: auraId,
      before,
      after: this.#auraSnapshot(aura),
      reason,
    });
    return aura;
  }

  #consumeAura(auraId, stacks, sourceSkillId) {
    const aura = this.state.auras[auraId];
    if (!aura) return;
    const before = this.#auraSnapshot(aura);
    const consumeCount = stacks === "all" ? aura.stacks : Math.max(1, stacks ?? 1);
    if (aura.stackingMode === "independent") {
      aura.stackExpiries.splice(0, consumeCount);
      aura.stacks = aura.stackExpiries.length;
      if (aura.stacks > 0) aura.expiresAt = Math.max(...aura.stackExpiries);
    } else {
    aura.stacks -= consumeCount;
    }
    if (aura.stacks <= 0) {
      delete this.state.auras[auraId];
      this.#emit("AURA_CONSUMED", { sourceSkillId, effectId: auraId, before, after: null, reason: "aura-consume" });
    } else {
      this.#emit("AURA_STACK_CHANGED", { sourceSkillId, effectId: auraId, before, after: this.#auraSnapshot(aura), reason: "aura-consume" });
    }
  }

  #expireAura(auraId, reason) {
    const aura = this.state.auras[auraId];
    if (!aura) return;
    const before = this.#auraSnapshot(aura);
    delete this.state.auras[auraId];
    this.#emit("AURA_EXPIRED", { sourceSkillId: aura.sourceSkillId, effectId: auraId, before, after: null, reason });
  }

  #changeEnergy(amount, reason, sourceSkillId, emit = true) {
    const before = this.state.energy;
    this.state.energy = clamp(before + amount, 0, this.profile.resources.energy.max);
    if (emit && Math.abs(this.state.energy - before) > EPSILON) {
      this.#emit("RESOURCE_CHANGED", { sourceSkillId, before, after: this.state.energy, reason, metadata: { resource: "energy", requestedAmount: amount } });
    }
    return this.state.energy - before;
  }

  #changeCombo(amount, reason, sourceSkillId, { allowOverflowBuffer = true } = {}) {
    const before = this.state.comboPoints;
    const requested = before + amount;
    this.state.comboPoints = clamp(requested, 0, this.profile.resources.comboPoints.max);
    const overcap = Math.max(0, requested - this.profile.resources.comboPoints.max);
    const bufferResult = allowOverflowBuffer && overcap > 0 && this.effectRuntime
      ? this.effectRuntime.bufferResourceOverflow("comboPoints", overcap, { sourceSkillId })
      : { buffered: 0, remaining: overcap };
    this.#emit("RESOURCE_CHANGED", {
      sourceSkillId,
      before,
      after: this.state.comboPoints,
      reason,
      metadata: {
        resource: "comboPoints",
        requestedAmount: amount,
        overcap,
        buffered: bufferResult.buffered,
        unbuffered: bufferResult.remaining,
      },
    });
    if (bufferResult.remaining > 0 && this.effectRuntime) {
      this.effectRuntime.dispatch("on_combo_overcap", { sourceSkillId, overcap: bufferResult.remaining });
    }
    return this.state.comboPoints - before;
  }

  #addCounter(counterId, amount, reason, sourceSkillId) {
    const before = this.state.counters[counterId] ?? 0;
    this.state.counters[counterId] = before + amount;
    this.#emit("COUNTER_CHANGED", { sourceSkillId, effectId: counterId, before, after: this.state.counters[counterId], reason });
  }

  #resetCounter(counterId, reason, sourceSkillId) {
    const before = this.state.counters[counterId] ?? 0;
    this.state.counters[counterId] = 0;
    this.#emit("COUNTER_CHANGED", { sourceSkillId, effectId: counterId, before, after: 0, reason });
  }

  #hasAura(auraId) {
    return Boolean(this.state.auras[auraId] && this.state.auras[auraId].expiresAt > this.state.nowMs + EPSILON);
  }

  #auraRemaining(auraId) {
    return Math.max(0, (this.state.auras[auraId]?.expiresAt ?? 0) - this.state.nowMs);
  }

  #cooldownRemaining(actionId) {
    const action = this.actionById[actionId];
    const actionReadyAt = this.state.cooldownReadyAt[actionId] ?? 0;
    const groupReadyAt = action?.cooldownGroup
      ? this.state.cooldownGroupReadyAt[action.cooldownGroup] ?? 0
      : 0;
    return Math.max(0, Math.max(actionReadyAt, groupReadyAt) - this.state.nowMs);
  }

  #currentCombatStats() {
    const statModifiers = {};
    for (const aura of Object.values(this.state.auras)) {
      const definition = this.auraDefinitions[aura.id];
      for (const [stat, value] of Object.entries(definition?.statModifiers ?? {})) {
        statModifiers[stat] = (statModifiers[stat] ?? 0) + Number(value) * aura.stacks;
      }
    }
    return resolveDynamicCombatStats(this.profile, statModifiers);
  }

  #dotRemaining(dot) {
    return dot ? Math.max(0, dot.expiresAt - this.state.nowMs) : 0;
  }

  #dotRefreshable(dot) {
    return !dot || this.#dotRemaining(dot) <= dot.pandemicThresholdMs + EPSILON;
  }

  #stateSummary() {
    return {
      timestamp: this.state.nowMs,
      energy: round(this.state.energy),
      comboPoints: this.state.comboPoints,
      activeTargetIndex: this.state.activeTargetIndex,
      gcdRemainingMs: Math.max(0, this.state.gcdReadyAt - this.state.nowMs),
      channelRemainingMs: this.state.channel ? Math.max(0, this.state.channel.endsAt - this.state.nowMs) : 0,
    };
  }

  #auraSnapshot(aura) {
    return {
      id: aura.id,
      stacks: aura.stacks,
      maxStacks: aura.maxStacks,
      sourceSkillId: aura.sourceSkillId,
      appliedAt: aura.appliedAt,
      refreshedAt: aura.refreshedAt,
      expiresAt: aura.expiresAt,
      remainingMs: Math.max(0, aura.expiresAt - this.state.nowMs),
      periodMs: aura.periodMs,
      nextTickAt: aura.nextTickAt,
      tickCount: aura.tickCount,
      stackingMode: aura.stackingMode ?? "refresh",
      stackExpiries: aura.stackExpiries ? [...aura.stackExpiries] : null,
      soonestRemainingMs: aura.stackExpiries?.length
        ? Math.max(0, aura.stackExpiries[0] - this.state.nowMs)
        : null,
    };
  }

  #dotSnapshot(dot) {
    if (dot.stackingMode === "independent") {
      return {
        id: dot.id,
        sourceSkillId: dot.sourceSkillId,
        targetIndex: dot.targetIndex,
        appliedAt: dot.appliedAt,
        expiresAt: dot.expiresAt,
        remainingMs: Math.max(0, dot.expiresAt - this.state.nowMs),
        soonestRemainingMs: Math.max(
          0,
          Math.min(...dot.instances.map((instance) => instance.expiresAt)) - this.state.nowMs,
        ),
        baseDurationMs: dot.baseDurationMs,
        pandemicThresholdMs: 0,
        refreshable: false,
        periodMs: dot.periodMs,
        nextTickAt: dot.nextTickAt,
        stacks: dot.instances.length,
        maxStacks: dot.maxStacks,
        refreshCount: 0,
        refreshMode: "independent",
        stackingMode: "independent",
        instances: dot.instances.map((instance) => ({
          ...instance,
          remainingMs: Math.max(0, instance.expiresAt - this.state.nowMs),
        })),
      };
    }
    return {
      id: dot.id,
      sourceSkillId: dot.sourceSkillId,
      targetIndex: dot.targetIndex,
      appliedAt: dot.appliedAt,
      expiresAt: dot.expiresAt,
      remainingMs: Math.max(0, dot.expiresAt - this.state.nowMs),
      baseDurationMs: dot.baseDurationMs,
      pandemicThresholdMs: dot.pandemicThresholdMs,
      refreshable: this.#dotRefreshable(dot),
      periodMs: dot.periodMs,
      nextTickAt: dot.nextTickAt,
      stacks: dot.stacks,
      refreshCount: dot.refreshCount,
      refreshMode: dot.refreshMode,
      stackingMode: dot.stackingMode ?? "refresh",
      maxStacks: dot.maxStacks ?? 1,
    };
  }

  #metrics() {
    const total = this.state.successfulCasts;
    return {
      totalCasts: total,
      perfectCasts: this.state.perfectCasts,
      blockedAttempts: this.state.blockedCasts,
      accuracy: total ? (this.state.perfectCasts / total) * 100 : 0,
      currentStreak: this.state.currentStreak,
      bestStreak: this.state.bestStreak,
      apm: this.state.nowMs > 0 ? (total / this.state.nowMs) * 60000 : 0,
    };
  }

  getSnapshot() {
    const cooldowns = Object.fromEntries(
      this.profile.actions.map((action) => [action.id, {
        skillId: action.id,
        remainingMs: this.#cooldownRemaining(action.id),
        durationMs: action.cooldownMs ?? 0,
        ready: this.#cooldownRemaining(action.id) <= EPSILON,
        trackingGroup: action.trackingGroup,
        cooldownGroup: action.cooldownGroup ?? null,
        cooldownGroupRemainingMs: action.cooldownGroup
          ? Math.max(
              0,
              (this.state.cooldownGroupReadyAt[action.cooldownGroup] ?? 0) - this.state.nowMs,
            )
          : 0,
      }]),
    );
    const cooldownGroups = Object.fromEntries(
      Object.entries(this.state.cooldownGroupReadyAt).map(([groupId, readyAt]) => [groupId, {
        groupId,
        readyAt,
        remainingMs: Math.max(0, readyAt - this.state.nowMs),
        ready: readyAt <= this.state.nowMs + EPSILON,
      }]),
    );
    const auras = Object.fromEntries(Object.entries(this.state.auras).map(([id, aura]) => [id, this.#auraSnapshot(aura)]));
    const actionStates = Object.fromEntries(this.profile.actions.map((action) => {
      const costs = this.#actionCosts(action);
      const cooldownRemainingMs = this.#cooldownRemaining(action.id);
      const actionBlock = this.#actionBlock(
        action,
        this.state.activeTargetIndex,
        costs.execution,
        costs,
      );
      return [action.id, {
        skillId: action.id,
        minimumCost: costs.minimum,
        maximumCost: costs.maximum,
        recommendedCost: costs.recommended,
        actualCost: costs.actual,
        minimumComboPoints: costs.execution.minimumComboPoints,
        isFree: costs.execution.isFree,
        cooldownRemainingMs,
        available: actionBlock == null,
        blockedCode: actionBlock?.code ?? null,
        blockedReason: actionBlock?.reason ?? null,
      }];
    }));
    return clone({
      schemaVersion: "interactive-controller-v2",
      profile: {
        id: this.profile.id,
        label: this.profile.label,
        gameVersion: this.profile.gameVersion,
        simcVersion: this.profile.simcVersion,
        specialization: this.profile.specialization,
        talentCode: this.profile.source.talentCode,
        setBonuses: this.profile.build.setBonuses,
        unsupportedFieldCount: this.profile.unsupportedFields.length,
        unsupportedEffectCount: this.profile.unsupportedEffects.length,
      },
      session: {
        id: this.state.sessionId,
        status: this.state.status,
        timestamp: this.state.nowMs,
        durationMs: this.state.durationMs,
        targetCount: this.state.targetCount,
        actionCount: this.state.actionCount,
      },
      resources: {
        energy: round(this.state.energy),
        maxEnergy: this.profile.resources.energy.max,
        comboPoints: this.state.comboPoints,
        maxComboPoints: this.profile.resources.comboPoints.max,
        energyRegenPerSecond: round(this.#energyRegenPerSecond()),
      },
      activeTargetIndex: this.state.activeTargetIndex,
      targets: this.state.targets.map((target) => ({
        ...target,
        dots: Object.fromEntries(Object.entries(target.dots).map(([id, dot]) => [id, dot ? this.#dotSnapshot(dot) : null])),
      })),
      gcd: { readyAt: this.state.gcdReadyAt, remainingMs: Math.max(0, this.state.gcdReadyAt - this.state.nowMs) },
      channel: this.state.channel ? { ...this.state.channel, remainingMs: Math.max(0, this.state.channel.endsAt - this.state.nowMs) } : null,
      cooldowns,
      cooldownGroups,
      actionStates,
      auras,
      counters: this.state.counters,
      mechanics: this.state.mechanics,
      recommendation: this.recommendation,
      metrics: this.#metrics(),
      combatStats: {
        ...this.#currentCombatStats(),
        base: this.profile.combatStats,
        currentHasteMultiplier: round(this.#hasteMultiplier(), 6),
      },
      rng: {
        ...this.rng.snapshot(),
        actionResults: this.actionResultRng.snapshot(),
      },
      actionHistory: this.state.actionHistory,
      eventHistory: this.eventHistory,
      catalog: {
        actions: this.profile.actions,
        internalActions: this.profile.internalActions,
        disabledActions: this.profile.disabledActions,
        effects: this.profile.effects,
        tracked: this.profile.tracked,
        unsupportedFields: this.profile.unsupportedFields,
        unsupportedEffects: this.profile.unsupportedEffects,
      },
    });
  }

  drainEvents() {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return clone(events);
  }

  #emit(type, payload = {}) {
    const event = {
      eventId: `evt-${++this.eventSequence}`,
      timestamp: this.state?.nowMs ?? 0,
      type,
      sourceSkillId: null,
      targetIndex: null,
      effectId: null,
      before: null,
      after: null,
      reason: null,
      ruleId: null,
      metadata: null,
      ...payload,
    };
    this.pendingEvents.push(event);
    this.eventHistory.push(event);
    if (this.eventHistory.length > MAX_HISTORY) this.eventHistory.splice(0, this.eventHistory.length - MAX_HISTORY);
    return event;
  }
}
