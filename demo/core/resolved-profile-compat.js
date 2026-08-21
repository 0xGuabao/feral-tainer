import { deepFreeze, invariant } from "./contracts.js";

// ResolvedProfile v2 is additive. This adapter exposes the stable v1 runtime
// surface for external consumers that have not adopted the new data namespaces.
export function createLegacyRuntimeProfile(profile) {
  invariant(profile?.schemaVersion === 2, "Legacy runtime adapter requires ResolvedProfile v2");
  return deepFreeze({
    schemaVersion: 1,
    id: profile.id,
    label: profile.label,
    gameVersion: profile.gameVersion,
    simcVersion: profile.simcVersion,
    level: profile.level,
    specialization: profile.specialization,
    source: profile.source,
    build: profile.build,
    session: profile.session,
    combatStats: profile.combatStats,
    resources: profile.resources,
    actions: profile.actions,
    actionById: profile.actionById,
    internalActions: profile.internalActions,
    internalActionById: profile.internalActionById,
    disabledActions: profile.disabledActions,
    disabledInternalActions: profile.disabledInternalActions,
    effects: profile.effects,
    disabledEffects: profile.disabledEffects,
    resolvedModifiers: profile.resolvedModifiers,
    replacements: profile.replacements,
    tracked: profile.tracked,
    apl: profile.apl,
    unsupportedFields: profile.unsupportedFields,
    unsupportedEffects: profile.unsupportedEffects,
    unsupportedAplRules: profile.unsupportedAplRules,
    fidelity: profile.fidelity,
  });
}
