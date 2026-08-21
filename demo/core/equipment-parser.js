import { createEquipmentVariantKey } from "./equipment-signature.js";
import { canonicalSimcEquipmentSlot } from "./simc-profile-parser.js";

function integerOrNull(value) {
  if (value == null || value === "") return null;
  if (!/^-?\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function integerList(value) {
  if (!value) return [];
  return value
    .split("/")
    .map((entry) => integerOrNull(entry))
    .filter((entry) => entry != null);
}

function collectOptions(segments) {
  const options = {};
  for (const segment of segments) {
    if (segment.kind !== "option") continue;
    (options[segment.key] ??= []).push(segment.value);
  }
  return options;
}

function firstOption(options, key) {
  return options[key]?.at(-1) ?? null;
}

export function parseEquipmentAssignment(assignment) {
  const options = collectOptions(assignment.valueSegments);
  const item = {
    slot: canonicalSimcEquipmentSlot(assignment.key),
    sourceKey: assignment.key,
    name: assignment.valueSegments[0]?.value || null,
    itemId: integerOrNull(firstOption(options, "id")),
    itemLevel: integerOrNull(firstOption(options, "ilevel")),
    bonusIds: integerList(firstOption(options, "bonus_id")),
    gemIds: integerList(firstOption(options, "gem_id")),
    enchantId: integerOrNull(firstOption(options, "enchant_id")),
    craftedStatIds: integerList(firstOption(options, "crafted_stats")),
    rawOptions: options,
    source: {
      lineNumber: assignment.lineNumber,
      rawLine: assignment.raw,
    },
  };
  return {
    ...item,
    variantKey: createEquipmentVariantKey(item),
  };
}

export function parseEquipment(input) {
  const assignments = input.simcProfile?.assignments
    .filter((assignment) => assignment.fieldKind === "equipment") ?? [];
  const parsedAssignments = assignments.map(parseEquipmentAssignment);
  const latestBySlot = new Map();
  for (const item of parsedAssignments) {
    latestBySlot.set(item.slot, item);
  }
  return {
    assignments,
    parsedAssignments,
    slots: [...latestBySlot.values()],
  };
}
