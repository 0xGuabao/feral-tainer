import { defaultCustomHandlerRegistry } from "./custom-handler-registry.js";

export const GENERIC_EFFECT_MECHANISMS = Object.freeze([
  "on_session_start",
  "on_action_impact",
  "on_action_result",
  "on_action_cast",
  "on_builder",
  "on_finisher",
  "on_combo_overcap",
  "on_dot_tick",
  "on_dot_state_change",
  "on_auto_attack",
  "on_channel_start",
  "on_channel_tick",
  "on_channel_complete",
  "on_aura_tick",
  "on_aura_expire",
  "percent_proc",
  "ppm",
  "rppm",
  "accumulator_proc",
  "internal_cooldown",
  "aura_stack",
  "aura_refresh",
  "aura_consume",
  "aura_sync",
  "random_choice",
  "combat_stat_modifier",
  "modify_duration",
  "replace_action",
  "resource_overflow_buffer",
  "execute_internal_action",
  "independent_dot",
  "target_selector",
]);

function readPath(value, path) {
  return String(path)
    .split(".")
    .reduce((current, key) => current?.[key], value);
}

function resolveValue(specification, context, profile) {
  if (typeof specification === "number") return specification;
  if (!specification || typeof specification !== "object") return 0;
  let value = Number.isFinite(specification.value) ? specification.value : 1;
  if (specification.context) value = Number(context[specification.context] ?? 0);
  if (specification.profilePath) value = Number(readPath(profile, specification.profilePath) ?? 0);
  if (specification.counter) value = Number(context.host.getCounter(specification.counter) ?? 0);
  if (specification.auraStacks) value = Number(context.host.auraStacks(specification.auraStacks) ?? 0);
  if (specification.activeDotStacks) {
    value = Number(context.host.activeDotStacks(specification.activeDotStacks) ?? 0);
  }
  if (specification.activeDotMaxRemaining) {
    value = Number(context.host.activeDotMaxRemaining(specification.activeDotMaxRemaining) ?? 0);
  }
  if (specification.anyOfContextCount) {
    const count = Math.max(0, Number(context[specification.anyOfContextCount] ?? 0));
    value = 1 - ((1 - value) ** count);
  }
  if (specification.divideByActiveDotCount) {
    const activeCount = Math.max(
      1,
      context.host.activeDotCount(specification.divideByActiveDotCount.dotId),
    );
    value /= activeCount ** (specification.divideByActiveDotCount.exponent ?? 1);
  }
  if (specification.multiplyTalentRank) {
    value *= profile.build.talents.byToken[specification.multiplyTalentRank]?.rank ?? 0;
  }
  value *= specification.multiply ?? 1;
  value += specification.add ?? 0;
  return value;
}

function matchesWhen(when, context, host) {
  if (!when) return true;
  if (when.actionIds && !when.actionIds.includes(context.action?.id)) return false;
  if (when.actionKinds && !when.actionKinds.includes(context.action?.kind)) return false;
  if (when.actionTags) {
    const tags = new Set(context.action?.tags ?? []);
    if (!when.actionTags.every((tag) => tags.has(tag))) return false;
  }
  if (when.auraUp && !host.hasAura(when.auraUp)) return false;
  if (when.auraIds && !when.auraIds.includes(context.auraId)) return false;
  if (when.dotIds && !when.dotIds.includes(context.dotId)) return false;
  if (when.counterPositive && host.getCounter(when.counterPositive) <= 0) return false;
  if (when.isProc != null && Boolean(context.isProc) !== when.isProc) return false;
  if (when.anyCrit != null && Boolean(context.anyCrit) !== when.anyCrit) return false;
  if (when.allCrit != null && Boolean(context.allCrit) !== when.allCrit) return false;
  if (when.minimumCritCount != null && Number(context.critCount ?? 0) < when.minimumCritCount) return false;
  return true;
}

export class EffectRuntime {
  constructor({ profile, host, rng, customHandlers = defaultCustomHandlerRegistry }) {
    this.profile = profile;
    this.host = host;
    this.rng = rng;
    this.customHandlers = customHandlers;
    this.triggerIcdReadyAt = new Map();
    this.rppmStates = new Map();
    this.subscriptions = new Map();

    for (const effect of profile.effects) {
      for (const [triggerIndex, trigger] of (effect.triggers ?? []).entries()) {
        if (!this.subscriptions.has(trigger.hook)) this.subscriptions.set(trigger.hook, []);
        this.subscriptions.get(trigger.hook).push({ effect, trigger, triggerIndex });
      }
    }
  }

  dispatch(hook, input = {}) {
    const context = {
      ...input,
      hook,
      timestamp: this.host.now(),
      actionCount: this.host.actionCount(),
      host: this.host,
    };
    const results = [];
    for (const subscription of this.subscriptions.get(hook) ?? []) {
      const result = this.#runSubscription(subscription, context);
      if (result) results.push(result);
    }
    return results;
  }

  modifyActionCost(action, baseCost) {
    let multiplier = 1;
    let override = null;
    const context = { action };
    for (const effect of this.profile.effects) {
      for (const modifier of effect.modifiers ?? []) {
        if (!matchesWhen(modifier.when, context, this.host)) continue;
        if (modifier.kind === "action_cost_multiplier") multiplier *= modifier.value;
        if (modifier.kind === "action_cost_override") override = modifier.value;
      }
    }
    return override ?? baseCost * multiplier;
  }

  modifyActionCritChance(action, baseChance) {
    let chance = baseChance;
    const context = { action };
    for (const effect of this.profile.effects) {
      for (const modifier of effect.modifiers ?? []) {
        if (!matchesWhen(modifier.when, context, this.host)) continue;
        if (modifier.kind === "action_crit_chance_add") chance += modifier.value;
        if (modifier.kind === "action_crit_chance_multiplier") chance *= modifier.value;
      }
    }
    return chance;
  }

  resolveActionExecution(action, { comboPoints, maxComboPoints }) {
    const execution = {
      isFree: false,
      consumeCombo: Boolean(action.comboSpend),
      effectiveComboPoints: action.comboSpend ? comboPoints : 0,
      minimumComboPoints: action.comboSpend ? 1 : 0,
    };
    const context = { action };
    for (const effect of this.profile.effects) {
      for (const modifier of effect.modifiers ?? []) {
        if (modifier.kind !== "action_execution") continue;
        if (!matchesWhen(modifier.when, context, this.host)) continue;
        if (modifier.isFree != null) execution.isFree = modifier.isFree;
        if (modifier.consumeCombo != null) execution.consumeCombo = modifier.consumeCombo;
        if (modifier.minimumComboPoints != null) execution.minimumComboPoints = modifier.minimumComboPoints;
        if (modifier.effectiveComboPoints === "max") execution.effectiveComboPoints = maxComboPoints;
        else if (modifier.effectiveComboPoints != null) execution.effectiveComboPoints = modifier.effectiveComboPoints;
      }
    }
    return execution;
  }

  bufferResourceOverflow(resource, amount, input = {}) {
    let remaining = Math.max(0, amount);
    let buffered = 0;
    const context = { ...input, resource };
    for (const effect of this.profile.effects) {
      for (const modifier of effect.modifiers ?? []) {
        if (modifier.kind !== "resource_overflow_buffer" || modifier.resource !== resource) continue;
        if (!matchesWhen(modifier.when, context, this.host)) continue;
        const available = Math.max(0, modifier.maxStacks - this.host.auraStacks(modifier.auraId));
        const accepted = Math.min(remaining, available);
        if (accepted <= 0) continue;
        this.host.applyAura(modifier.auraId, {
          durationMs: modifier.durationMs,
          stacks: accepted,
          maxStacks: modifier.maxStacks,
          replaceStacks: false,
          sourceSkillId: input.sourceSkillId ?? null,
          reason: "resource-overflow-buffer",
        });
        buffered += accepted;
        remaining -= accepted;
      }
    }
    return { buffered, remaining };
  }

  #runSubscription({ effect, trigger, triggerIndex }, context) {
    if (!matchesWhen(trigger.when, context, this.host)) return null;
    const icdKey = `${effect.id}:${trigger.internalCooldownKey ?? triggerIndex}`;
    const internalCooldownMs = trigger.proc?.internalCooldownMs ?? trigger.internalCooldownMs ?? 0;
    if ((this.triggerIcdReadyAt.get(icdKey) ?? 0) > context.timestamp) return null;

    let procResult = null;
    if (trigger.proc) {
      if (trigger.proc.kind === "accumulator") {
        procResult = this.#runAccumulatorProc(effect, trigger.proc, context);
        if (!procResult.triggered) return { effectId: effect.id, triggered: false, procResult };
        this.host.emit("PROC_TRIGGERED", {
          effectId: effect.id,
          sourceSkillId: context.action?.id ?? context.sourceSkillId ?? null,
          targetIndex: context.targetIndex ?? null,
          reason: `${effect.name}触发`,
          metadata: { ...procResult, mechanism: trigger.proc.kind, hook: context.hook },
        });
      } else {
        let chance = 0;
        let rppmResult = null;
        if (trigger.proc.kind === "rppm") {
          rppmResult = this.#prepareRppm(effect, trigger.proc, context);
          if (rppmResult.skip) return null;
          chance = rppmResult.chance;
        } else {
          chance = this.#procChance(trigger.proc, context);
        }
        procResult = {
          ...this.rng.roll(effect.id, chance, context),
          ...(rppmResult?.metadata ?? {}),
        };
        if (rppmResult) this.#commitRppm(rppmResult.stateKey, procResult.triggered);
        this.host.emit("PROC_ROLL", {
          effectId: effect.id,
          sourceSkillId: context.action?.id ?? context.sourceSkillId ?? null,
          targetIndex: context.targetIndex ?? null,
          reason: procResult.triggered ? "roll-succeeded" : "roll-failed",
          metadata: { ...procResult, mechanism: trigger.proc.kind, hook: context.hook },
        });
        if (!procResult.triggered) return { effectId: effect.id, triggered: false, procResult };
        this.host.emit("PROC_TRIGGERED", {
          effectId: effect.id,
          sourceSkillId: context.action?.id ?? context.sourceSkillId ?? null,
          targetIndex: context.targetIndex ?? null,
          reason: `${effect.name}触发`,
          metadata: { ...procResult, mechanism: trigger.proc.kind, hook: context.hook },
        });
      }
    }

    if (internalCooldownMs > 0) {
      this.triggerIcdReadyAt.set(icdKey, context.timestamp + internalCooldownMs);
    }
    for (const operation of trigger.operations ?? []) {
      this.#executeOperation(operation, { ...context, effect });
    }
    return { effectId: effect.id, triggered: true, procResult };
  }

  #runAccumulatorProc(effect, proc, context) {
    const threshold = proc.threshold ?? 1000;
    const accumulatorId = proc.accumulatorId ?? effect.id;
    const existing = this.host.getMechanicState(accumulatorId);
    const initialValue = existing?.value ?? (
      proc.initial === "random" && this.rng.mode !== "scripted"
        ? this.rng.next() * threshold
        : 0
    );
    const scale = proc.scaleByContext?.values?.[context[proc.scaleByContext.context]] ?? 0;
    const activeDotCount = Math.max(1, this.host.activeDotCount(context.dotId));
    const exponent = proc.activeDotExponent ?? 1;
    const talentMultiplier = proc.talentMultiplier
      ? this.profile.build.talents.byToken[proc.talentMultiplier.token]
        ? proc.talentMultiplier.selected
        : proc.talentMultiplier.fallback
      : 1;
    const raw = (scale * talentMultiplier) / (activeDotCount ** exponent);
    const scripted = this.rng.consumeScript(effect.id, context);
    const randomFactor = this.rng.mode === "scripted"
      ? scripted ? null : 0
      : this.rng.next() * (proc.randomMultiplier ?? 1);
    const contribution = scripted
      ? Math.max(0, threshold - initialValue)
      : raw * randomFactor;
    const accumulated = initialValue + contribution;
    const triggered = accumulated >= threshold;
    const nextValue = triggered ? accumulated - threshold : accumulated;
    const nextState = {
      value: nextValue,
      threshold,
      triggerCount: (existing?.triggerCount ?? 0) + (triggered ? 1 : 0),
    };
    this.host.setMechanicState(accumulatorId, nextState);
    const result = {
      triggered,
      accumulatorId,
      before: initialValue,
      contribution,
      accumulated,
      after: nextValue,
      threshold,
      scale,
      talentMultiplier,
      activeDotCount,
      exponent,
      raw,
      randomFactor,
      mode: this.rng.mode,
      scriptIndex: scripted?.index ?? null,
    };
    this.host.emit("PROC_ACCUMULATOR", {
      effectId: effect.id,
      sourceSkillId: context.action?.id ?? context.sourceSkillId ?? null,
      targetIndex: context.targetIndex ?? null,
      reason: triggered ? "threshold-reached" : "accumulator-progress",
      metadata: { ...result, mechanism: proc.kind, hook: context.hook },
    });
    return result;
  }

  #procChance(proc, context) {
    if (proc.kind === "percent_proc") {
      return resolveValue(proc.chance, context, this.profile);
    }
    if (proc.kind === "ppm") {
      let rate = proc.ppm ?? proc.rppm ?? 0;
      if (proc.modifierTalent && this.profile.build.talents.byToken[proc.modifierTalent.token]) {
        rate *= proc.modifierTalent.multiplier;
      }
      return (rate * (context.intervalMs ?? 0)) / 60000;
    }
    throw new Error(`Unsupported proc kind '${proc.kind}' in effect runtime`);
  }

  #prepareRppm(effect, proc, context) {
    let rate = proc.rppm ?? 0;
    if (proc.modifierTalent && this.profile.build.talents.byToken[proc.modifierTalent.token]) {
      rate *= proc.modifierTalent.multiplier;
    }
    const stateKey = proc.stateKey ?? effect.id;
    const existing = this.rppmStates.get(stateKey) ?? {
      lastAttemptAt: null,
      accumulatedBlpMs: 0,
      triggerCount: 0,
    };
    if (existing.lastAttemptAt === context.timestamp) {
      return { skip: true, stateKey };
    }
    const elapsedMs = Math.max(
      0,
      Math.min(
        3500,
        existing.lastAttemptAt == null
          ? context.timestamp
          : context.timestamp - existing.lastAttemptAt,
      ),
    );
    existing.accumulatedBlpMs += elapsedMs;
    existing.lastAttemptAt = context.timestamp;
    const expectedIntervalMs = rate > 0 ? 60000 / rate : Infinity;
    const badLuckMultiplier = proc.badLuckProtection === false || !Number.isFinite(expectedIntervalMs)
      ? 1
      : Math.max(
          1,
          1 + ((Math.min(existing.accumulatedBlpMs, 1000000) / expectedIntervalMs - 1.5) * 3),
        );
    const chance = (rate * elapsedMs / 60000) * badLuckMultiplier;
    this.rppmStates.set(stateKey, existing);
    return {
      skip: false,
      stateKey,
      chance,
      metadata: {
        rppm: rate,
        intervalMs: elapsedMs,
        accumulatedBlpMs: existing.accumulatedBlpMs,
        badLuckMultiplier,
        stateKey,
      },
    };
  }

  #commitRppm(stateKey, triggered) {
    if (!triggered) return;
    const state = this.rppmStates.get(stateKey);
    if (!state) return;
    state.accumulatedBlpMs = 0;
    state.triggerCount += 1;
  }

  #executeOperation(operation, context) {
    const sourceSkillId = context.action?.id ?? context.sourceSkillId ?? null;
    if (operation.kind === "random_choice") {
      const choices = (operation.choices ?? []).filter((choice) => Number(choice.weight ?? 1) > 0);
      const totalWeight = choices.reduce((total, choice) => total + Number(choice.weight ?? 1), 0);
      if (totalWeight <= 0) return;
      const roll = this.rng.next();
      let cursor = roll * totalWeight;
      let selectedIndex = choices.length - 1;
      for (let index = 0; index < choices.length; index += 1) {
        cursor -= Number(choices[index].weight ?? 1);
        if (cursor < 0) {
          selectedIndex = index;
          break;
        }
      }
      const selected = choices[selectedIndex];
      this.host.emit("RANDOM_CHOICE_SELECTED", {
        effectId: context.effect.id,
        sourceSkillId,
        targetIndex: context.targetIndex ?? null,
        reason: selected.label ?? `choice-${selectedIndex}`,
        metadata: {
          operation: "random_choice",
          selectedIndex,
          selectedLabel: selected.label ?? null,
          roll,
          totalWeight,
        },
      });
      for (const nestedOperation of selected.operations ?? []) {
        this.#executeOperation(nestedOperation, context);
      }
      return;
    }
    if (operation.kind === "aura_sync") {
      const maxStacks = operation.maxStacks ?? 1;
      const stacks = Math.max(
        0,
        Math.min(maxStacks, Math.floor(resolveValue(operation.stacks, context, this.profile))),
      );
      const durationMs = resolveValue(operation.durationMs, context, this.profile);
      if (stacks <= 0 || durationMs <= 0) {
        this.host.consumeAura(operation.auraId, "all", sourceSkillId);
        return;
      }
      this.host.applyAura(operation.auraId, {
        durationMs,
        stacks,
        maxStacks,
        replaceStacks: true,
        stackingMode: operation.stackingMode ?? "refresh",
        sourceSkillId,
        reason: "aura_sync",
      });
      return;
    }
    if (operation.kind === "aura_refresh" || operation.kind === "aura_stack") {
      const durationMs = operation.durationFromCounter
        ? this.host.getCounter(operation.durationFromCounter)
        : operation.durationMs;
      const maxStacks = operation.maxStacksTalent
        ? this.profile.build.talents.byToken[operation.maxStacksTalent.token]
          ? operation.maxStacksTalent.selected
          : operation.maxStacksTalent.fallback
        : operation.maxStacks;
      this.host.applyAura(operation.auraId, {
        durationMs,
        stacks: operation.stacks ?? 1,
        maxStacks: maxStacks ?? 1,
        replaceStacks: operation.kind === "aura_refresh" ? operation.replaceStacks ?? true : false,
        stackingMode: operation.stackingMode ?? "refresh",
        sourceSkillId,
        reason: operation.kind,
      });
      return;
    }
    if (operation.kind === "aura_consume") {
      this.host.consumeAura(operation.auraId, operation.stacks, sourceSkillId);
      return;
    }
    if (operation.kind === "energy_change") {
      this.host.changeEnergy(resolveValue(operation.amount, context, this.profile), context.effect.id, sourceSkillId);
      return;
    }
    if (operation.kind === "combo_change") {
      this.host.changeCombo(
        resolveValue(operation.amount, context, this.profile),
        context.effect.id,
        sourceSkillId,
        { allowOverflowBuffer: !operation.suppressOverflowBuffer },
      );
      return;
    }
    if (operation.kind === "counter_add") {
      this.host.addCounter(
        operation.counterId,
        resolveValue(operation.amount, context, this.profile),
        context.effect.id,
        sourceSkillId,
      );
      return;
    }
    if (operation.kind === "counter_reset") {
      this.host.resetCounter(operation.counterId, context.effect.id, sourceSkillId);
      return;
    }
    if (operation.kind === "execute_internal_action") {
      const targetIndex = this.host.selectTarget(operation.target ?? "context", context);
      this.host.executeInternalAction(operation.actionId, targetIndex, {
        originSkillId: sourceSkillId,
        effectId: context.effect.id,
        ...(operation.metadata ?? {}),
      });
      return;
    }
    if (operation.kind === "customHandler") {
      this.customHandlers.execute(operation.handlerId, {
        operation,
        context,
        profile: this.profile,
        host: this.host,
        rng: this.rng,
      });
      return;
    }
    throw new Error(`Unsupported effect operation '${operation.kind}'`);
  }
}
