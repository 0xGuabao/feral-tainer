export const RESOLVED_PROFILE_SCHEMA_VERSION = 2;
export const UNSUPPORTED_EFFECT_SCHEMA_VERSION = 1;
export const UNSUPPORTED_FIELD_SCHEMA_VERSION = 1;

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function createUnsupportedEffect({
  effectId,
  sourceKind,
  sourceId,
  sourceName,
  sourceRank,
  mechanism,
  reason,
  impact = "unknown",
  blocksAction = false,
  evidenceRefs = [],
}) {
  invariant(effectId, "unsupportedEffects.effectId is required");
  invariant(sourceKind, `unsupportedEffects[${effectId}].sourceKind is required`);
  invariant(reason, `unsupportedEffects[${effectId}].reason is required`);

  return deepFreeze({
    schemaVersion: UNSUPPORTED_EFFECT_SCHEMA_VERSION,
    effectId,
    sourceKind,
    sourceId: sourceId ?? null,
    sourceName: sourceName ?? null,
    sourceRank: sourceRank ?? null,
    mechanism: mechanism ?? "unknown",
    reason,
    impact,
    blocksAction: Boolean(blocksAction),
    evidenceRefs: [...evidenceRefs],
  });
}

export function createUnsupportedField({
  fieldId,
  key,
  operator,
  value,
  rawValue,
  lineNumber,
  rawLine,
  fieldKind,
  reason,
  impact = "profile-semantics-not-applied",
}) {
  invariant(fieldId, "unsupportedFields.fieldId is required");
  invariant(reason, `unsupportedFields[${fieldId}].reason is required`);

  return deepFreeze({
    schemaVersion: UNSUPPORTED_FIELD_SCHEMA_VERSION,
    fieldId,
    key: key ?? null,
    operator: operator ?? null,
    value: value ?? null,
    rawValue: rawValue ?? null,
    lineNumber: lineNumber ?? null,
    rawLine: rawLine ?? null,
    fieldKind: fieldKind ?? "unknown",
    reason,
    impact,
  });
}

export function assertResolvedProfile(profile) {
  invariant(profile?.schemaVersion === RESOLVED_PROFILE_SCHEMA_VERSION, "ResolvedProfile schema version mismatch");
  invariant(profile?.id, "ResolvedProfile.id is required");
  invariant(profile?.gameVersion, "ResolvedProfile.gameVersion is required");
  invariant(profile?.specialization?.id === 103, "ResolvedProfile must target Feral Druid (spec 103)");
  invariant(profile?.character?.class?.token === "druid", "ResolvedProfile.character must describe a Druid");
  invariant(profile?.character?.specialization?.id === 103, "ResolvedProfile.character must target Feral spec 103");
  invariant(profile?.build?.talents, "ResolvedProfile.build.talents is required");
  invariant(Array.isArray(profile?.equipment?.slots), "ResolvedProfile.equipment.slots must be an array");
  invariant(profile?.baseStats && typeof profile.baseStats === "object", "ResolvedProfile.baseStats is required");
  invariant(profile?.derivedStats && typeof profile.derivedStats === "object", "ResolvedProfile.derivedStats is required");
  invariant(Array.isArray(profile?.setBonuses?.enabled), "ResolvedProfile.setBonuses.enabled must be an array");
  invariant(Array.isArray(profile?.itemEffects), "ResolvedProfile.itemEffects must be an array");
  invariant(Array.isArray(profile?.actions), "ResolvedProfile.actions must be an array");
  invariant(Array.isArray(profile?.internalActions), "ResolvedProfile.internalActions must be an array");
  invariant(Array.isArray(profile?.effects), "ResolvedProfile.effects must be an array");
  invariant(Array.isArray(profile?.resolvedModifiers), "ResolvedProfile.resolvedModifiers must be an array");
  invariant(Array.isArray(profile?.apl?.rules), "ResolvedProfile.apl.rules must be an array");
  invariant(Array.isArray(profile?.unsupportedFields), "ResolvedProfile.unsupportedFields must be an array");
  invariant(Array.isArray(profile?.unsupportedEffects), "ResolvedProfile.unsupportedEffects must be an array");

  const actionIds = new Set();
  for (const action of profile.actions) {
    invariant(action.id && !actionIds.has(action.id), `ResolvedProfile contains duplicate action '${action.id}'`);
    actionIds.add(action.id);
  }
  for (const action of profile.internalActions) {
    invariant(action.id && !actionIds.has(action.id), `ResolvedProfile contains duplicate internal action '${action.id}'`);
    actionIds.add(action.id);
  }
  for (const rule of profile.apl.rules) {
    invariant(actionIds.has(rule.actionId), `APL rule '${rule.id}' references unavailable action '${rule.actionId}'`);
  }
  return profile;
}

export function resolvedProfileDiff(left, right) {
  const indexById = (items) => new Map(items.map((item) => [item.id, item]));
  const selectedRanks = (profile) => profile.build.talents.byToken;
  const leftTalents = selectedRanks(left);
  const rightTalents = selectedRanks(right);
  const talentTokens = new Set([...Object.keys(leftTalents), ...Object.keys(rightTalents)]);
  const talentChanges = [...talentTokens]
    .map((token) => ({
      token,
      left: leftTalents[token]?.rank ?? 0,
      right: rightTalents[token]?.rank ?? 0,
    }))
    .filter((entry) => entry.left !== entry.right)
    .sort((a, b) => a.token.localeCompare(b.token));

  const leftActions = indexById(left.actions);
  const rightActions = indexById(right.actions);
  const allActionIds = new Set([...leftActions.keys(), ...rightActions.keys()]);
  const actionChanges = [...allActionIds]
    .map((id) => ({ id, leftEnabled: leftActions.has(id), rightEnabled: rightActions.has(id) }))
    .filter((entry) => entry.leftEnabled !== entry.rightEnabled)
    .sort((a, b) => a.id.localeCompare(b.id));

  const leftInternalActions = indexById(left.internalActions);
  const rightInternalActions = indexById(right.internalActions);
  const allInternalActionIds = new Set([...leftInternalActions.keys(), ...rightInternalActions.keys()]);
  const internalActionChanges = [...allInternalActionIds]
    .map((id) => ({
      id,
      leftEnabled: leftInternalActions.has(id),
      rightEnabled: rightInternalActions.has(id),
    }))
    .filter((entry) => entry.leftEnabled !== entry.rightEnabled)
    .sort((a, b) => a.id.localeCompare(b.id));

  const leftEffects = new Set(left.effects.map((effect) => effect.id));
  const rightEffects = new Set(right.effects.map((effect) => effect.id));
  const effectChanges = [...new Set([...leftEffects, ...rightEffects])]
    .map((id) => ({ id, leftEnabled: leftEffects.has(id), rightEnabled: rightEffects.has(id) }))
    .filter((entry) => entry.leftEnabled !== entry.rightEnabled)
    .sort((a, b) => a.id.localeCompare(b.id));

  const scalarChanges = (leftValue, rightValue, prefix = "") => {
    const keys = new Set([
      ...Object.keys(leftValue ?? {}),
      ...Object.keys(rightValue ?? {}),
    ]);
    return [...keys].flatMap((key) => {
      const leftEntry = leftValue?.[key];
      const rightEntry = rightValue?.[key];
      const path = prefix ? `${prefix}.${key}` : key;
      const leftObject = leftEntry && typeof leftEntry === "object" && !Array.isArray(leftEntry);
      const rightObject = rightEntry && typeof rightEntry === "object" && !Array.isArray(rightEntry);
      if (leftObject || rightObject) return scalarChanges(leftEntry, rightEntry, path);
      if (typeof leftEntry !== "number" && typeof rightEntry !== "number") return [];
      return Object.is(leftEntry, rightEntry) ? [] : [{ path, left: leftEntry ?? null, right: rightEntry ?? null }];
    }).sort((a, b) => a.path.localeCompare(b.path));
  };

  const valueChanges = (leftValue, rightValue, prefix = "") => {
    const keys = new Set([
      ...Object.keys(leftValue ?? {}),
      ...Object.keys(rightValue ?? {}),
    ]);
    return [...keys].flatMap((key) => {
      const leftEntry = leftValue?.[key];
      const rightEntry = rightValue?.[key];
      const path = prefix ? `${prefix}.${key}` : key;
      const leftObject = leftEntry && typeof leftEntry === "object" && !Array.isArray(leftEntry);
      const rightObject = rightEntry && typeof rightEntry === "object" && !Array.isArray(rightEntry);
      if (leftObject || rightObject) return valueChanges(leftEntry, rightEntry, path);
      return JSON.stringify(leftEntry) === JSON.stringify(rightEntry)
        ? []
        : [{ path, left: leftEntry ?? null, right: rightEntry ?? null }];
    }).sort((a, b) => a.path.localeCompare(b.path));
  };

  const equipmentBySlot = (profile) => new Map(profile.equipment.slots.map((item) => [item.slot, item]));
  const leftEquipment = equipmentBySlot(left);
  const rightEquipment = equipmentBySlot(right);
  const equipmentChanges = [...new Set([...leftEquipment.keys(), ...rightEquipment.keys()])]
    .map((slot) => ({
      slot,
      left: leftEquipment.get(slot) ?? null,
      right: rightEquipment.get(slot) ?? null,
    }))
    .filter((entry) => JSON.stringify(entry.left) !== JSON.stringify(entry.right))
    .sort((a, b) => a.slot.localeCompare(b.slot));

  const leftSetBonuses = new Set(left.setBonuses.enabled.map((entry) => entry.id));
  const rightSetBonuses = new Set(right.setBonuses.enabled.map((entry) => entry.id));
  const setBonusChanges = [...new Set([...leftSetBonuses, ...rightSetBonuses])]
    .map((id) => ({ id, leftEnabled: leftSetBonuses.has(id), rightEnabled: rightSetBonuses.has(id) }))
    .filter((entry) => entry.leftEnabled !== entry.rightEnabled)
    .sort((a, b) => a.id.localeCompare(b.id));

  const leftModifiers = indexById(left.resolvedModifiers.map((entry) => ({ ...entry, id: entry.effectId })));
  const rightModifiers = indexById(right.resolvedModifiers.map((entry) => ({ ...entry, id: entry.effectId })));
  const modifierChanges = [...new Set([...leftModifiers.keys(), ...rightModifiers.keys()])]
    .map((effectId) => {
      const leftModifier = leftModifiers.get(effectId) ?? null;
      const rightModifier = rightModifiers.get(effectId) ?? null;
      const comparable = (modifier) => modifier && {
        talentRanks: modifier.talentRanks,
        setBonuses: modifier.setBonuses,
        resolution: modifier.resolution,
        modifierKinds: modifier.modifierKinds,
        triggerHooks: modifier.triggerHooks,
      };
      return {
        effectId,
        left: comparable(leftModifier),
        right: comparable(rightModifier),
      };
    })
    .filter((entry) => JSON.stringify(entry.left) !== JSON.stringify(entry.right))
    .sort((a, b) => a.effectId.localeCompare(b.effectId));

  return deepFreeze({
    leftProfileId: left.id,
    rightProfileId: right.id,
    talentChanges,
    actionChanges,
    internalActionChanges,
    effectChanges,
    characterChanges: valueChanges(left.character, right.character, "character"),
    equipmentChanges,
    baseStatChanges: valueChanges(left.baseStats, right.baseStats, "baseStats"),
    derivedStatChanges: valueChanges(left.derivedStats, right.derivedStats, "derivedStats"),
    setBonusChanges,
    itemEffectChanges: valueChanges(left.itemEffects, right.itemEffects, "itemEffects"),
    resourceChanges: scalarChanges(left.resources, right.resources, "resources"),
    combatStatChanges: scalarChanges(left.combatStats, right.combatStats, "combatStats"),
    modifierChanges,
    unsupportedFields: {
      left: left.unsupportedFields,
      right: right.unsupportedFields,
    },
    unsupportedEffects: {
      left: left.unsupportedEffects,
      right: right.unsupportedEffects,
    },
  });
}
