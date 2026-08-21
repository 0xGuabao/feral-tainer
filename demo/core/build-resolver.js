import {
  ACTION_CATALOG,
  APL_CATALOG,
  EFFECT_CATALOG,
  FERAL_VERSION,
  INTERNAL_ACTION_CATALOG,
  SET_BONUS_CATALOG,
  TALENT_EFFECT_COVERAGE,
} from "../data/12.1/feral-game-data.js";
import { FERAL_TIER_SET_CATALOG } from "../data/12.1/feral-tier-sets.generated.js";
import {
  ITEM_ACTION_CATALOG,
  ITEM_EFFECT_CATALOG,
} from "../data/12.1/feral-item-effect-data.js";
import { TalentDecoder } from "./talent-decoder.js";
import { normalizeBuildInput } from "./build-input.js";
import { resolveCharacter } from "./character-resolver.js";
import { resolveEquipment } from "./equipment-resolver.js";
import { resolveItemEffects } from "./item-effect-resolver.js";
import { resolveSetBonuses } from "./set-bonus-resolver.js";
import { createStatProfile } from "./stat-resolver.js";
import {
  RESOLVED_PROFILE_SCHEMA_VERSION,
  assertResolvedProfile,
  createUnsupportedEffect,
  deepFreeze,
} from "./contracts.js";

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function evaluateRequirement(requirement, context) {
  if (!requirement) return { met: true, reasons: [] };
  if (requirement.talent) {
    const rank = context.talents.byToken[requirement.talent]?.rank ?? 0;
    const expected = requirement.minRank ?? 1;
    return {
      met: rank >= expected,
      reasons: rank >= expected ? [] : [`需要天赋 ${requirement.talent} ${expected} 级（当前 ${rank}）`],
    };
  }
  if (requirement.setBonus) {
    const met = context.setBonuses.has(requirement.setBonus);
    return { met, reasons: met ? [] : [`需要套装 ${requirement.setBonus}`] };
  }
  if (requirement.itemId) {
    const met = context.equipment.slots.some((item) => item.itemId === requirement.itemId);
    return { met, reasons: met ? [] : [`需要装备物品 ${requirement.itemId}`] };
  }
  if (requirement.itemVariantKey) {
    const met = context.equipment.slots.some((item) => item.variantKey === requirement.itemVariantKey);
    return { met, reasons: met ? [] : [`需要装备变体 ${requirement.itemVariantKey}`] };
  }
  if (requirement.enchantId) {
    const met = context.equipment.slots.some((item) => item.enchantId === requirement.enchantId);
    return { met, reasons: met ? [] : [`需要附魔 ${requirement.enchantId}`] };
  }
  if (requirement.all) {
    const results = requirement.all.map((entry) => evaluateRequirement(entry, context));
    return { met: results.every((entry) => entry.met), reasons: results.flatMap((entry) => entry.reasons) };
  }
  if (requirement.any) {
    const results = requirement.any.map((entry) => evaluateRequirement(entry, context));
    return {
      met: results.some((entry) => entry.met),
      reasons: results.some((entry) => entry.met) ? [] : [`至少满足一项：${results.flatMap((entry) => entry.reasons).join("；")}`],
    };
  }
  if (requirement.not) {
    const result = evaluateRequirement(requirement.not, context);
    return { met: !result.met, reasons: result.met ? ["要求的排除条件已启用"] : [] };
  }
  return { met: false, reasons: ["未知 requirement 类型"] };
}

function resolveCatalogEntries(catalog, context) {
  const enabled = [];
  const disabled = [];
  for (const definition of catalog) {
    const result = evaluateRequirement(definition.requirements, context);
    if (result.met) enabled.push(clone(definition));
    else disabled.push({ id: definition.id, name: definition.name, reasons: result.reasons });
  }
  return { enabled, disabled };
}

function applyResolutionEffect(effect, state) {
  const resolution = effect.resolution;
  if (!resolution) return;

  if (resolution.kind === "combat_stat_modifier") {
    const rank = state.talents.byToken[resolution.rankFromTalent]?.rank ?? 0;
    const current = Number(state.combatStats[resolution.stat] ?? 0);
    state.combatStats[resolution.stat] = Math.round(
      (current + (resolution.addPerRank ?? 0) * rank) * 1e12,
    ) / 1e12;
    return;
  }

  if (resolution.kind === "combat_stat_multiplier") {
    const count = resolution.enchantId == null
      ? 1
      : state.equipment.slots.filter((item) => item.enchantId === resolution.enchantId).length;
    const current = Number(state.combatStats[resolution.stat] ?? 1);
    const multiplier = resolution.multiplierPerEquippedEnchant == null
      ? Number(resolution.multiplier ?? 1)
      : Number(resolution.multiplierPerEquippedEnchant) ** count;
    state.combatStats[resolution.stat] = Math.round(current * multiplier * 1e12) / 1e12;
    return;
  }

  if (resolution.kind === "resource_modifier") {
    const resource = state.resources[resolution.resource];
    const rank = state.talents.byToken[resolution.rankFromTalent]?.rank ?? 0;
    resource.max += (resolution.maxAddPerRank ?? 0) * rank;
    resource.initial = resource.max;
    const percent = resolution.regenPercentByRank?.[rank] ?? 0;
    resource.regenPerSecond = Math.round(resource.regenPerSecond * (1 + percent / 100) * 1000) / 1000;
    return;
  }

  if (resolution.kind === "modify_cooldown" || resolution.kind === "modify_cooldowns") {
    const actionIds = resolution.actionIds ?? [resolution.actionId];
    for (const actionId of actionIds) {
      const action = state.actionById.get(actionId) ?? state.internalActionById.get(actionId);
      if (action) action.cooldownMs = Math.max(0, (action.cooldownMs ?? 0) + resolution.addMs);
    }
    return;
  }

  if (resolution.kind === "modify_dot") {
    const durationActionIds = resolution.durationActionIds ?? resolution.actionIds ?? [];
    const periodActionIds = resolution.periodActionIds ?? resolution.actionIds ?? [];
    const durationSet = new Set(durationActionIds);
    const periodSet = new Set(periodActionIds);
    for (const actionId of new Set([...durationActionIds, ...periodActionIds])) {
      const action = state.actionById.get(actionId) ?? state.internalActionById.get(actionId);
      if (!action?.dot) continue;
      if (durationSet.has(actionId)) {
        if (action.dot.durationMs) {
          action.dot.durationMs = (
            action.dot.durationMs + (resolution.durationAddMs ?? 0)
          ) * (resolution.durationMultiplier ?? 1);
        }
        if (action.dot.durationFormula) action.dot.durationFormula.multiplier =
          (action.dot.durationFormula.multiplier ?? 1) * (resolution.durationMultiplier ?? 1);
      }
      if (periodSet.has(actionId)) action.dot.periodMs *= resolution.periodMultiplier ?? 1;
    }
    return;
  }

  if (resolution.kind === "modify_aura_duration") {
    const actionIds = resolution.actionIds ?? [resolution.actionId];
    for (const actionId of actionIds) {
      const action = state.actionById.get(actionId) ?? state.internalActionById.get(actionId);
      const aura = action?.auras?.find((entry) => entry.auraId === resolution.auraId);
      if (aura) aura.durationMs += resolution.addMs;
    }
    return;
  }

  if (resolution.kind === "modify_channel") {
    const action = state.actionById.get(resolution.actionId);
    if (!action?.channel) return;
    action.cooldownMs = Math.round((action.cooldownMs ?? 0) * (resolution.cooldownMultiplier ?? 1));
    action.channel.durationMs = Math.round(action.channel.durationMs * (resolution.durationMultiplier ?? 1));
    action.channel.tickCount = Math.round(action.channel.tickCount * (resolution.tickCountMultiplier ?? 1));
    action.channel.parameters = {
      ...action.channel.parameters,
      ...clone(resolution.parameters ?? {}),
    };
    action.channelMs = action.channel.durationMs;
    return;
  }

  if (resolution.kind === "replace_action") {
    if (state.actionById.has(resolution.toActionId)) {
      state.replacements.set(resolution.fromActionId, resolution.toActionId);
      state.actionById.delete(resolution.fromActionId);
    }
  }
}

function requirementSources(requirement, context, result = { talents: [], setBonuses: [], items: [], enchants: [] }) {
  if (!requirement) return result;
  if (requirement.talent) {
    result.talents.push({
      token: requirement.talent,
      minimumRank: requirement.minRank ?? 1,
      selectedRank: context.talents.byToken[requirement.talent]?.rank ?? 0,
    });
  }
  if (requirement.setBonus) {
    result.setBonuses.push({ id: requirement.setBonus, selected: context.setBonuses.has(requirement.setBonus) });
  }
  if (requirement.itemId) {
    result.items.push({
      itemId: requirement.itemId,
      equipped: context.equipment.slots.some((item) => item.itemId === requirement.itemId),
    });
  }
  if (requirement.itemVariantKey) {
    result.items.push({
      variantKey: requirement.itemVariantKey,
      equipped: context.equipment.slots.some((item) => item.variantKey === requirement.itemVariantKey),
    });
  }
  if (requirement.enchantId) {
    result.enchants.push({
      enchantId: requirement.enchantId,
      equipped: context.equipment.slots.some((item) => item.enchantId === requirement.enchantId),
    });
  }
  for (const child of requirement.all ?? requirement.any ?? []) requirementSources(child, context, result);
  if (requirement.not) requirementSources(requirement.not, context, result);
  return result;
}

function buildResolvedModifiers(effects, context) {
  return effects.map((effect) => {
    const sources = requirementSources(effect.requirements, context);
    return {
      effectId: effect.id,
      name: effect.name,
      mechanism: effect.mechanism,
      talentRanks: sources.talents,
      setBonuses: sources.setBonuses,
      items: sources.items,
      enchants: sources.enchants,
      resolution: clone(effect.resolution ?? null),
      modifierKinds: (effect.modifiers ?? []).map((modifier) => modifier.kind),
      triggerHooks: (effect.triggers ?? []).map((trigger) => trigger.hook),
    };
  });
}

function buildUnsupportedEffects(talents, context) {
  const unsupported = [];
  for (const selected of Object.values(talents.byToken)) {
    if (selected.treeIndex === 4) continue;
    const coverage = TALENT_EFFECT_COVERAGE[selected.token];
    if (coverage?.status === "supported") continue;

    const detail = coverage?.unsupported ?? coverage ?? {};
    const applicability = evaluateRequirement(coverage?.applicability, context);
    const inactiveByBuild = Boolean(coverage?.applicability) && !applicability.met;
    unsupported.push(
      createUnsupportedEffect({
        effectId: `talent:${selected.token}`,
        sourceKind: "talent",
        sourceId: selected.entryIds?.join(",") ?? selected.entryId,
        sourceName: selected.name,
        sourceRank: selected.rank,
        mechanism: detail.mechanism ?? (coverage?.status === "out_of_scope" ? "out_of_scope" : "unclassified_talent_effect"),
        reason: inactiveByBuild
          ? `当前构筑未满足该机制的运行前提（${applicability.reasons.join("；")}），因此本构筑不会触发；其通用实现仍未完成。${detail.reason ? ` ${detail.reason}` : ""}`
          : detail.reason ??
            "该已选天赋尚未映射到 Action/Effect Catalog；为避免静默忽略，构筑被标记为部分支持。",
        impact: inactiveByBuild
          ? "inactive-by-build"
          : detail.impact ?? (coverage?.status === "out_of_scope" ? "out-of-scope" : "unknown"),
        evidenceRefs: detail.sourceRefs ?? [],
      }),
    );
  }
  return unsupported;
}

function collectTrackedCatalog(actions, effects) {
  const dots = new Map();
  const auras = new Map();
  for (const action of actions) {
    if (action.dot && !dots.has(action.dot.id)) {
      dots.set(action.dot.id, {
        id: action.dot.id,
        name: action.dot.name ?? action.name,
        shortName: action.dot.shortName ?? action.shortName,
        color: action.dot.color ?? action.color,
        spellId: action.dot.spellId,
        icon: clone(action.dot.icon ?? action.icon),
        periodMs: action.dot.periodMs,
      });
    }
    for (const aura of action.auras ?? []) {
      if (!auras.has(aura.auraId)) {
        auras.set(aura.auraId, {
          id: aura.auraId,
          name: aura.name ?? action.name,
          shortName: action.shortName,
          color: action.color,
          maxStacks: aura.maxStacks ?? 1,
          icon: clone(aura.icon ?? action.icon),
        });
      }
    }
  }
  for (const effect of effects) {
    for (const aura of [effect.aura, ...(effect.auras ?? [])].filter(Boolean)) {
      if (!auras.has(aura.id)) {
        auras.set(aura.id, {
          ...clone(aura),
          name: aura.name ?? effect.name,
          shortName: aura.shortName ?? effect.name.slice(0, 1),
          color: aura.color ?? "teal",
        });
      }
    }
  }
  return { dots: [...dots.values()], auras: [...auras.values()] };
}

export class BuildResolver {
  constructor({ decoder = new TalentDecoder() } = {}) {
    this.decoder = decoder;
  }

  resolve(rawInput) {
    const input = normalizeBuildInput(rawInput);
    const talents = this.decoder.decode(input.talentCode);
    const characterResolution = resolveCharacter(input, FERAL_VERSION);
    const parsedEquipment = resolveEquipment(input);
    const itemEffectResolution = resolveItemEffects(parsedEquipment);
    const equipmentResolutionComplete =
      itemEffectResolution.complete && parsedEquipment.staticModifiers.complete;
    const equipment = deepFreeze({
      ...clone(parsedEquipment),
      status: parsedEquipment.statsComplete
        ? equipmentResolutionComplete
          ? "resolved"
          : "resolved-stats-effects-partial"
        : parsedEquipment.status,
      complete: parsedEquipment.statsComplete && equipmentResolutionComplete,
      itemEffects: clone(itemEffectResolution.itemEffects),
    });
    const setBonusResolution = resolveSetBonuses(input, SET_BONUS_CATALOG, {
      equipment,
      tierSetCatalog: FERAL_TIER_SET_CATALOG,
    });
    const setBonuses = new Set(setBonusResolution.requestedIds);
    const context = { talents, setBonuses, equipment };
    const actionResolution = resolveCatalogEntries([...ACTION_CATALOG, ...ITEM_ACTION_CATALOG], context);
    const internalActionResolution = resolveCatalogEntries(INTERNAL_ACTION_CATALOG, context);
    const effectResolution = resolveCatalogEntries([...EFFECT_CATALOG, ...ITEM_EFFECT_CATALOG], context);
    const resources = clone(FERAL_VERSION.resources);
    const combatStats = clone(FERAL_VERSION.combatStats);
    const actionById = new Map(actionResolution.enabled.map((action) => [action.id, action]));
    const internalActionById = new Map(internalActionResolution.enabled.map((action) => [action.id, action]));
    const resolutionState = {
      talents,
      resources,
      combatStats,
      equipment,
      actionById,
      internalActionById,
      replacements: new Map(),
    };

    for (const effect of effectResolution.enabled) applyResolutionEffect(effect, resolutionState);
    const statProfile = createStatProfile({
      combatStats,
      baselineCombatStats: FERAL_VERSION.combatStats,
      character: characterResolution.character,
      equipment,
    });
    const runtimeCombatStats = clone(statProfile.combatStats);
    const actions = [...actionById.values()];
    const internalActions = [...internalActionById.values()];
    const availableActionIds = new Set(actions.map((action) => action.id));
    const aplRules = APL_CATALOG
      .map((rule) => ({
        ...clone(rule),
        actionId: resolutionState.replacements.get(rule.actionId) ?? rule.actionId,
      }))
      .filter((rule) => availableActionIds.has(rule.actionId));
    const tracked = collectTrackedCatalog([...actions, ...internalActions], effectResolution.enabled);
    const unsupportedEffects = buildUnsupportedEffects(talents, context);

    for (const unknownSet of setBonusResolution.unknown) {
      unsupportedEffects.push(
        createUnsupportedEffect({
          effectId: `set:${unknownSet}`,
          sourceKind: "tier-set",
          sourceId: unknownSet,
          sourceName: unknownSet,
          mechanism: "unknown_set_bonus",
          reason: "该套装标识不在 12.1 野性德鲁伊目录中。",
          impact: "unknown",
        }),
      );
    }

    for (const tierSet of setBonusResolution.enabled.filter((entry) => entry.implementationStatus === "unsupported")) {
      unsupportedEffects.push(
        createUnsupportedEffect({
          effectId: `set:${tierSet.id}`,
          sourceKind: "tier-set",
          sourceId: tierSet.spellId ?? tierSet.id,
          sourceName: tierSet.setName ?? tierSet.name ?? tierSet.id,
          mechanism: "tier_set_effect",
          reason: `${tierSet.tier ?? "未知"} ${tierSet.pieces ?? "?"} 件套已由装备自动识别，但战斗效果尚未进入 Effect Catalog。`,
          impact: "combat-state",
          evidenceRefs: [tierSet.source?.sourceRef].filter(Boolean),
        }),
      );
    }

    for (const [index, conflict] of setBonusResolution.conflicts.entries()) {
      unsupportedEffects.push(
        createUnsupportedEffect({
          effectId: `set-conflict:${index + 1}`,
          sourceKind: "tier-set",
          sourceId: conflict.kind,
          sourceName: "套装来源冲突",
          mechanism: "set_bonus_conflict",
          reason: `${conflict.reason} 显式：${conflict.explicitFamilies.join("、")}；装备：${conflict.detectedFamilies.join("、")}。`,
          impact: "build-resolution",
        }),
      );
    }

    for (const itemEffect of equipment.itemEffects.filter((entry) =>
      entry.status === "unsupported")) {
      unsupportedEffects.push(
        createUnsupportedEffect({
          effectId: itemEffect.id,
          sourceKind: itemEffect.sourceKind,
          sourceId: itemEffect.sourceId,
          sourceName: itemEffect.sourceName,
          mechanism: itemEffect.mechanism,
          reason: itemEffect.reason,
          impact: "combat-state",
        }),
      );
    }

    for (const detail of itemEffectResolution.unsupportedDetails) {
      unsupportedEffects.push(
        createUnsupportedEffect({
          effectId: detail.id,
          sourceKind: detail.sourceKind,
          sourceId: detail.sourceId,
          sourceName: detail.sourceName,
          mechanism: detail.mechanism,
          reason: detail.reason,
          impact: detail.impact,
          evidenceRefs: detail.evidenceRefs,
        }),
      );
    }

    for (const modifier of equipment.staticModifiers.unresolved) {
      unsupportedEffects.push(
        createUnsupportedEffect({
          effectId: `equipment-modifier:${modifier.sourceKind}:${modifier.sourceId}:${modifier.slot}`,
          sourceKind: modifier.sourceKind,
          sourceId: modifier.sourceId,
          sourceName: modifier.sourceName,
          mechanism: "static_equipment_modifier",
          reason: modifier.reason,
          impact: "base-stats",
          evidenceRefs: [modifier.variantKey].filter(Boolean),
        }),
      );
    }

    const consumedFieldIds = new Set([
      ...characterResolution.consumedFieldIds,
      ...setBonusResolution.consumedFieldIds,
      ...equipment.consumedFieldIds,
    ]);
    const unsupportedFields = input.unsupportedFields.filter((field) => !consumedFieldIds.has(field.fieldId));

    const profile = {
      schemaVersion: RESOLVED_PROFILE_SCHEMA_VERSION,
      id: input.id,
      label: input.label,
      gameVersion: FERAL_VERSION.gameVersion,
      simcVersion: FERAL_VERSION.simcVersion,
      level: characterResolution.character.level,
      specialization: clone(FERAL_VERSION.specialization),
      character: clone(characterResolution.character),
      source: {
        kind: input.kind,
        description: input.source,
        talentCode: input.talentCode,
        hasFullSimcProfile: Boolean(input.sourceProfileText),
        simcProfileSchemaVersion: input.simcProfile?.schemaVersion ?? null,
        parsedFieldCount: input.simcProfile?.assignments.length ?? 0,
        sourceMap: clone(input.simcProfile?.sourceMap ?? {}),
      },
      sourceMap: clone(input.simcProfile?.sourceMap ?? {}),
      build: {
        talents,
        setBonuses: [...setBonuses],
      },
      equipment: clone(equipment),
      baseStats: clone(statProfile.baseStats),
      derivedStats: clone(statProfile.derivedStats),
      setBonuses: {
        schemaVersion: setBonusResolution.schemaVersion,
        enabled: clone(setBonusResolution.enabled),
        unknown: clone(setBonusResolution.unknown),
        requestedIds: clone(setBonusResolution.requestedIds),
        profileDeclarations: clone(setBonusResolution.profileDeclarations),
        detectedFromEquipment: clone(setBonusResolution.detectedFromEquipment),
        conflicts: clone(setBonusResolution.conflicts),
      },
      itemEffects: clone(equipment.itemEffects),
      session: {
        targetCounts: [...FERAL_VERSION.targetCounts],
        durationMs: FERAL_VERSION.sessionDurationMs,
        baseGcdMs: FERAL_VERSION.baseGcdMs,
      },
      combatStats: runtimeCombatStats,
      resources,
      actions,
      actionById: Object.fromEntries(actions.map((action) => [action.id, action])),
      internalActions,
      internalActionById: Object.fromEntries(internalActions.map((action) => [action.id, action])),
      disabledActions: actionResolution.disabled,
      disabledInternalActions: internalActionResolution.disabled,
      effects: effectResolution.enabled,
      disabledEffects: effectResolution.disabled,
      resolvedModifiers: buildResolvedModifiers(effectResolution.enabled, context),
      replacements: Object.fromEntries(resolutionState.replacements),
      tracked,
      apl: { adapter: "feral-12.1-interactive-subset", rules: aplRules },
      unsupportedFields: clone(unsupportedFields),
      unsupportedEffects,
      fidelity: {
        damageCalculated: false,
        procRngMatchesSimcSequence: false,
        truthBoundary: "资源、技能可用性、DoT/Buff 时间、通用触发和 APL 子集；不计算伤害。",
      },
    };

    assertResolvedProfile(profile);
    return deepFreeze(profile);
  }
}

export function resolveFeralBuild(input) {
  return new BuildResolver().resolve(input);
}
