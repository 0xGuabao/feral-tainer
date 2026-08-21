import { deepFreeze } from "./contracts.js";
import { getProfileAssignments } from "./simc-profile-parser.js";

function parseProfileSetBonus(value, knownIds) {
  if (knownIds.has(value)) return { ids: [value], understood: true };
  const separator = value.lastIndexOf("=");
  if (separator > 0) {
    const id = value.slice(0, separator).trim();
    const rawEnabled = value.slice(separator + 1).trim();
    if (/^-?\d+$/.test(rawEnabled) && knownIds.has(id)) {
      const enabled = Number.parseInt(rawEnabled, 10);
      return { ids: enabled > 0 ? [id] : [], understood: true };
    }
  }
  return { ids: [], understood: false };
}

function setFamily(id) {
  return id.replace(/_[24]pc$/, "");
}

function deriveFromEquipment(equipment, tierSetCatalog) {
  const equippedItemIds = new Set(equipment.slots.map((item) => item.itemId).filter(Boolean));
  return tierSetCatalog.flatMap((entry) => {
    const equippedPieces = entry.itemIds.filter((itemId) => equippedItemIds.has(itemId));
    return equippedPieces.length >= entry.pieces
      ? [{ ...entry, equippedPieces }]
      : [];
  });
}

export function resolveSetBonuses(input, catalog, { equipment, tierSetCatalog = [] } = {}) {
  const knownById = new Map(catalog.map((entry) => [entry.id, entry]));
  const tierById = new Map(tierSetCatalog.map((entry) => [entry.id, entry]));
  const recognizedIds = new Set([...knownById.keys(), ...tierById.keys()]);
  const requestedIds = new Set(input.setBonuses);
  const consumedFieldIds = [];
  const profileDeclarations = [];

  for (const assignment of input.simcProfile ? getProfileAssignments(input.simcProfile, "set_bonus") : []) {
    const parsed = parseProfileSetBonus(assignment.value, recognizedIds);
    profileDeclarations.push({
      value: assignment.value,
      lineNumber: assignment.lineNumber,
      understood: parsed.understood,
      resolvedIds: parsed.ids,
    });
    for (const id of parsed.ids) requestedIds.add(id);
    if (parsed.understood) consumedFieldIds.push(`line:${assignment.lineNumber}:${assignment.key}`);
  }

  const detectedFromEquipment = deriveFromEquipment(equipment ?? { slots: [] }, tierSetCatalog);
  for (const detected of detectedFromEquipment) requestedIds.add(detected.id);

  const enabled = [...requestedIds]
    .filter((id) => knownById.has(id) || tierById.has(id))
    .map((id) => {
      const known = knownById.get(id);
      const tier = tierById.get(id);
      const detected = detectedFromEquipment.find((entry) => entry.id === id);
      return {
        ...(tier ?? {}),
        ...(known ?? {}),
        id,
        implementationStatus: known ? "supported" : "unsupported",
        source: input.setBonuses.includes(id)
          ? "build-input"
          : detected
            ? "equipment"
            : "simc-profile",
        equippedPieces: detected?.equippedPieces ?? [],
      };
    });
  const unknown = [...requestedIds].filter((id) => !knownById.has(id) && !tierById.has(id));
  const explicitFamilies = new Set(input.setBonuses.map(setFamily));
  const detectedFamilies = new Set(detectedFromEquipment.map((entry) => setFamily(entry.id)));
  const conflicts = explicitFamilies.size > 0 && detectedFamilies.size > 0 &&
    ![...explicitFamilies].some((family) => detectedFamilies.has(family))
    ? [{
        kind: "explicit-vs-equipment-tier-mismatch",
        explicitFamilies: [...explicitFamilies],
        detectedFamilies: [...detectedFamilies],
        reason: "显式套装覆盖与装备自动识别属于不同赛季，不能视为同一套装。",
      }]
    : [];

  return deepFreeze({
    schemaVersion: 1,
    enabled,
    unknown,
    requestedIds: [...requestedIds],
    profileDeclarations,
    detectedFromEquipment,
    conflicts,
    consumedFieldIds,
  });
}
