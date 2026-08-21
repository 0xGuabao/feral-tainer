import { EQUIPMENT_EFFECT_IMPLEMENTATIONS } from "../data/12.1/feral-item-effect-data.js";
import { deepFreeze } from "./contracts.js";

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function implementationKey(sourceKind, sourceId) {
  return `${sourceKind}:${sourceId}`;
}

export function resolveItemEffects(equipment) {
  const implementations = new Map(
    EQUIPMENT_EFFECT_IMPLEMENTATIONS.map((entry) => [
      implementationKey(entry.sourceKind, entry.sourceId),
      entry,
    ]),
  );
  const unsupportedDetails = [];
  const itemEffects = equipment.itemEffects.map((rawEffect) => {
    const implementation = implementations.get(
      implementationKey(rawEffect.sourceKind, rawEffect.sourceId),
    );
    if (!implementation) return clone(rawEffect);

    const item = equipment.bySlot[rawEffect.slot] ?? null;
    const supportedVariant = !implementation.variants?.length ||
      implementation.variants.includes(item?.variantKey);
    if (!supportedVariant) {
      return {
        ...clone(rawEffect),
        sourceName: implementation.name,
        status: "unsupported",
        reason: `已识别物品，但变体 ${item?.variantKey ?? "unknown"} 尚无经过 SimC 校验的效果数值。`,
      };
    }

    for (const detail of implementation.unsupportedEffects ?? []) {
      unsupportedDetails.push({
        ...clone(detail),
        sourceKind: implementation.sourceKind,
        sourceId: implementation.sourceId,
        sourceName: implementation.name,
      });
    }
    return {
      ...clone(rawEffect),
      sourceName: implementation.name,
      status: implementation.status,
      reason: implementation.status === "supported"
        ? "装备效果已由版本化 Catalog 和通用运行时解析。"
        : implementation.status === "out-of-scope"
          ? "该效果已识别，且明确不影响当前静止输出木桩模型。"
          : "主要装备效果已解析；仍有明确列出的边缘机制未实现。",
      actionIds: clone(implementation.actionIds ?? []),
      effectIds: clone(implementation.effectIds ?? []),
    };
  });

  return deepFreeze({
    schemaVersion: 1,
    itemEffects,
    unsupportedDetails,
    complete: itemEffects.every((entry) =>
      entry.status === "supported" || entry.status === "out-of-scope"),
  });
}
