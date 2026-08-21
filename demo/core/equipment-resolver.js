import { deepFreeze } from "./contracts.js";
import { SIMC_ITEM_VARIANT_CATALOG } from "../data/12.1/simc-oracle-catalog.generated.js";
import {
  EQUIPMENT_EFFECT_IMPLEMENTATIONS,
  EQUIPMENT_STATIC_MODIFIER_CATALOG,
} from "../data/12.1/feral-item-effect-data.js";
import { parseEquipment } from "./equipment-parser.js";

const knownItemEffectIds = new Set(
  EQUIPMENT_EFFECT_IMPLEMENTATIONS
    .filter((entry) => entry.sourceKind === "item")
    .map((entry) => entry.sourceId),
);

function resolveItem(item) {
  const variantKey = item.variantKey;
  const oracleVariant = SIMC_ITEM_VARIANT_CATALOG[variantKey] ?? null;
  return {
    ...item,
    variantKey,
    resolvedStats: oracleVariant?.stats ?? null,
    resolution: {
      itemData: oracleVariant ? "simc-oracle" : "pending",
      stats: oracleVariant ? "simc-oracle" : "pending",
      effects: oracleVariant?.effectsStatus ?? "pending",
      sourceProfileSha256: oracleVariant?.sourceProfileSha256 ?? null,
    },
  };
}

function variantSupported(definition, item) {
  return !definition.variants?.length || definition.variants.includes(item.variantKey);
}

function resolveStaticModifiers(slots) {
  const contributions = [];
  const unresolved = [];
  const totals = {};
  const knownGemIds = new Set(
    EQUIPMENT_STATIC_MODIFIER_CATALOG
      .filter((entry) => entry.sourceKind === "gem")
      .map((entry) => entry.sourceId),
  );

  function addContribution(definition, item, count = 1) {
    if (!variantSupported(definition, item)) {
      unresolved.push({
        sourceKind: definition.sourceKind,
        sourceId: definition.sourceId,
        sourceName: definition.name,
        slot: item.slot,
        variantKey: item.variantKey,
        reason: "该静态属性仅有其他装备变体的已验证数值。",
      });
      return;
    }
    const stats = Object.fromEntries(
      Object.entries(definition.stats).map(([stat, value]) => [stat, value * count]),
    );
    for (const [stat, value] of Object.entries(stats)) {
      totals[stat] = (totals[stat] ?? 0) + value;
    }
    contributions.push({
      id: `${definition.sourceKind}:${definition.sourceId}:${item.slot}`,
      sourceKind: definition.sourceKind,
      sourceId: definition.sourceId,
      sourceName: definition.name,
      slot: item.slot,
      count,
      stats,
      sourceRef: definition.sourceRef,
    });
  }

  for (const item of slots) {
    const gemCounts = new Map();
    for (const gemId of item.gemIds) gemCounts.set(gemId, (gemCounts.get(gemId) ?? 0) + 1);
    for (const [gemId, count] of gemCounts) {
      const definition = EQUIPMENT_STATIC_MODIFIER_CATALOG.find(
        (entry) => entry.sourceKind === "gem" && entry.sourceId === gemId,
      );
      if (definition) addContribution(definition, item, count);
      else if (!knownGemIds.has(gemId)) {
        unresolved.push({
          sourceKind: "gem",
          sourceId: gemId,
          sourceName: `gem_${gemId}`,
          slot: item.slot,
          variantKey: item.variantKey,
          reason: "宝石已解析，但静态属性尚未进入版本化 Equipment Modifier Catalog。",
        });
      }
    }

    for (const definition of EQUIPMENT_STATIC_MODIFIER_CATALOG) {
      if (definition.sourceKind === "enchant" && definition.sourceId === item.enchantId) {
        addContribution(definition, item);
      }
      if (definition.sourceKind === "item" && definition.sourceId === item.itemId) {
        addContribution(definition, item);
      }
    }
  }

  return {
    schemaVersion: 1,
    complete: unresolved.length === 0,
    totals,
    contributions,
    unresolved,
  };
}

export function resolveEquipment(input) {
  const parsed = parseEquipment(input);
  const slots = parsed.slots.map(resolveItem);
  const resolvedAssignments = parsed.parsedAssignments.map(resolveItem);
  const statsComplete = slots.length > 0 && slots.every((item) => item.resolvedStats != null);
  const staticModifiers = resolveStaticModifiers(slots);
  const itemEffects = slots.flatMap((item) => {
    const effects = [];
    if (
      item.slot === "trinket1" ||
      item.slot === "trinket2" ||
      knownItemEffectIds.has(item.itemId)
    ) {
      effects.push({
        id: `item:${item.itemId}:special-effect`,
        sourceKind: "item",
        sourceId: item.itemId,
        sourceName: item.name,
        slot: item.slot,
        mechanism: "item_special_effect",
        status: "unsupported",
        reason: "物品静态属性已由 SimC Oracle 解析；饰品使用/触发效果等待 Item Effect Catalog。",
      });
    }
    if (item.enchantId) {
      effects.push({
        id: `enchant:${item.enchantId}:${item.slot}`,
        sourceKind: "enchant",
        sourceId: item.enchantId,
        sourceName: `enchant_${item.enchantId}`,
        slot: item.slot,
        mechanism: "enchant_effect",
        status: "unsupported",
        reason: "附魔已保留并参与 Oracle 装备快照；独立静态/触发语义等待 Enchant Catalog。",
      });
    }
    return effects;
  });
  return deepFreeze({
    schemaVersion: 1,
    status: !input.simcProfile
      ? "not-provided"
      : statsComplete
        ? "resolved-stats-effects-pending"
        : "parsed-pending-data-resolution",
    complete: statsComplete && slots.every((item) => item.resolution.effects === "resolved"),
    statsComplete,
    staticModifiers,
    slots,
    bySlot: Object.fromEntries(slots.map((item) => [item.slot, item])),
    itemEffects,
    consumedFieldIds: resolvedAssignments
      .filter((item) => item.resolvedStats != null)
      .map((item) => `line:${item.source.lineNumber}:${item.sourceKey}`),
    unresolvedVariantKeys: slots.filter((item) => !item.resolvedStats).map((item) => item.variantKey),
  });
}
