import { mkdir, readFile, writeFile } from "node:fs/promises";

import { buildInputFromFixture, normalizeBuildInput } from "../demo/core/build-input.js";
import { BuildResolver } from "../demo/core/build-resolver.js";
import { resolvedProfileDiff } from "../demo/core/contracts.js";
import { decodeFeralTalentCode, encodeFeralTalentCode } from "../demo/core/talent-decoder.js";
import { BUILD_FIXTURES } from "../demo/data/12.1/build-fixtures.js";
import { DRUID_TALENT_TREE_12_1 } from "../demo/data/12.1/druid-talent-tree.generated.js";
import { SIMC_VERSION_LOCK } from "../demo/data/12.1/version.generated.js";

const outputDirectory = new URL("../validation/architecture/", import.meta.url);
const outputFile = new URL("build-switch-acceptance.json", outputDirectory);
const resolver = new BuildResolver();

function twinSproutsBuildInput() {
  const decoded = decodeFeralTalentCode(BUILD_FIXTURES.simcWildstalker.talentCode);
  const twinSprouts = DRUID_TALENT_TREE_12_1.nodes
    .flatMap((node) => node.entries)
    .find((entry) => entry.name === "Twin Sprouts");
  const selections = decoded.selections.map((selection) => selection.token === "implant"
    ? {
        ...twinSprouts,
        token: "twin_sprouts",
        rank: 1,
        purchased: true,
        partial: false,
        choiceIndex: 0,
      }
    : selection);
  return normalizeBuildInput({
    kind: "talent-code",
    id: "feral-simc-wildstalker-twin-sprouts-4pc",
    label: "SimC Wildstalker Twin Sprouts（4 件套）",
    talentCode: encodeFeralTalentCode(selections),
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
    source: "derived from SimC Wildstalker fixture by switching the Implant choice node",
  });
}

function rootNetworkBuildInput() {
  const decoded = decodeFeralTalentCode(BUILD_FIXTURES.simcWildstalker.talentCode);
  const rootNetwork = DRUID_TALENT_TREE_12_1.nodes
    .flatMap((node) => node.entries)
    .find((entry) => entry.name === "Root Network");
  const selections = decoded.selections.map((selection) => selection.token === "resilient_flourishing"
    ? {
        ...rootNetwork,
        token: "root_network",
        rank: 1,
        purchased: true,
        partial: false,
        choiceIndex: 1,
      }
    : selection);
  return normalizeBuildInput({
    kind: "talent-code",
    id: "feral-simc-wildstalker-root-network-4pc",
    label: "SimC Wildstalker Root Network（4 件套）",
    talentCode: encodeFeralTalentCode(selections),
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
    source: "derived from SimC Wildstalker fixture by switching the Resilient Flourishing choice node",
  });
}

function unsupportedSummary(profile) {
  const byImpact = {};
  const byMechanism = {};
  for (const effect of profile.unsupportedEffects) {
    byImpact[effect.impact] = (byImpact[effect.impact] ?? 0) + 1;
    byMechanism[effect.mechanism] = (byMechanism[effect.mechanism] ?? 0) + 1;
  }
  return {
    count: profile.unsupportedEffects.length,
    byImpact,
    byMechanism,
    stateFidelityGaps: profile.unsupportedEffects
      .filter((effect) => !["damage-only", "out-of-scope", "inactive-by-build"].includes(effect.impact))
      .map(({ effectId, sourceName, sourceRank, mechanism, reason, impact, evidenceRefs }) => ({
        effectId,
        sourceName,
        sourceRank,
        mechanism,
        reason,
        impact,
        evidenceRefs,
      })),
  };
}

function unsupportedFieldSummary(profile) {
  const byKind = {};
  for (const field of profile.unsupportedFields) {
    byKind[field.fieldKind] = (byKind[field.fieldKind] ?? 0) + 1;
  }
  return {
    count: profile.unsupportedFields.length,
    byKind,
    fields: profile.unsupportedFields,
  };
}

function unsupportedAplSummary(profile) {
  const byReason = {};
  for (const rule of profile.unsupportedAplRules) {
    byReason[rule.reasonCode] = (byReason[rule.reasonCode] ?? 0) + 1;
  }
  return {
    count: profile.unsupportedAplRules.length,
    byReason,
    rules: profile.unsupportedAplRules,
  };
}

function profileSummary(profile) {
  return {
    id: profile.id,
    label: profile.label,
    gameVersion: profile.gameVersion,
    simcVersion: profile.simcVersion,
    source: {
      kind: profile.source.kind,
      description: profile.source.description,
      talentCode: profile.source.talentCode,
      hasFullSimcProfile: profile.source.hasFullSimcProfile,
      simcProfileSchemaVersion: profile.source.simcProfileSchemaVersion,
      parsedFieldCount: profile.source.parsedFieldCount,
    },
    character: profile.character,
    equipment: profile.equipment,
    baseStats: profile.baseStats,
    derivedStats: profile.derivedStats,
    resolvedSetBonuses: profile.setBonuses,
    itemEffects: profile.itemEffects,
    setBonuses: profile.build.setBonuses,
    selectedTalents: Object.fromEntries(
      Object.entries(profile.build.talents.byToken)
        .map(([token, talent]) => [token, talent.rank])
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    resources: profile.resources,
    enabledActionIds: profile.actions.map((action) => action.id),
    internalActionIds: profile.internalActions.map((action) => action.id),
    disabledActions: profile.disabledActions,
    enabledEffectIds: profile.effects.map((effect) => effect.id),
    resolvedModifiers: profile.resolvedModifiers,
    trackedDotIds: profile.tracked.dots.map((dot) => dot.id),
    trackedAuraIds: profile.tracked.auras.map((aura) => aura.id),
    apl: {
      adapter: profile.apl.adapter,
      schemaVersion: profile.apl.schemaVersion,
      source: profile.apl.source,
      profileRuleCount: profile.apl.profileRuleCount,
      accountedProfileRuleCount: profile.apl.accountedProfileRuleCount,
      rules: profile.apl.rules.map(({ id, actionId, profileSource }) => ({ id, actionId, profileSource })),
      filteredRules: profile.apl.filteredRules,
    },
    convoke: profile.actionById.convoke
      ? {
          cooldownMs: profile.actionById.convoke.cooldownMs,
          channel: profile.actionById.convoke.channel,
        }
      : null,
    unsupportedSummary: unsupportedSummary(profile),
    unsupportedFieldSummary: unsupportedFieldSummary(profile),
    unsupportedAplSummary: unsupportedAplSummary(profile),
  };
}

const userProfile = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.userValidation));
const primalWrathProfile = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.primalWrath));
const guidanceProfile = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.simcWildstalker));
const twinSproutsProfile = resolver.resolve(twinSproutsBuildInput());
const rootNetworkProfile = resolver.resolve(rootNetworkBuildInput());
const fullSimcText = await readFile(
  new URL("../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url),
  "utf8",
);
const fullSimcProfile = resolver.resolve(normalizeBuildInput({
  kind: "simc-profile",
  id: "feral-simc-wildstalker-full-profile-4pc",
  label: "SimC MID1 Wildstalker 完整 Profile（4 件套）",
  profileText: fullSimcText,
  source: "vendor/simc/profiles/MID1/MID1_Druid_Feral.simc",
}));
const report = {
  schemaVersion: 3,
  purpose: "12.1 Feral build-switch architecture acceptance",
  versionLock: SIMC_VERSION_LOCK,
  fixtures: [
    profileSummary(userProfile),
    profileSummary(primalWrathProfile),
    profileSummary(guidanceProfile),
    profileSummary(twinSproutsProfile),
    profileSummary(rootNetworkProfile),
    profileSummary(fullSimcProfile),
  ],
  resolvedProfileDiff: resolvedProfileDiff(userProfile, primalWrathProfile),
  convokeProfileDiff: resolvedProfileDiff(userProfile, guidanceProfile),
  wildstalkerChoiceDiff: resolvedProfileDiff(guidanceProfile, twinSproutsProfile),
  wildstalkerRootNetworkDiff: resolvedProfileDiff(guidanceProfile, rootNetworkProfile),
  fullProfileVsTalentCodeDiff: resolvedProfileDiff(guidanceProfile, fullSimcProfile),
  acceptanceEvidence: {
    controllerApiUnchanged: true,
    uiOrControllerEditsRequiredForFixtureSwitch: false,
    unavailableActionsRejected: [
      { profileId: userProfile.id, actionId: "primalWrath" },
      { profileId: primalWrathProfile.id, actionId: "moonfire" },
    ],
    coveredByAutomatedTests: [
      "talent decode and semantic round-trip",
      "action enable/disable and profile diff",
      "active hero subtree filtering and inactive selection preservation",
      "talent-rank resource and tiered mechanism resolution",
      "Pouncing Strikes, Strategic Infusion and rank-4 Unseen Predator event order",
      "talent-code and SimC-profile normalization",
      "resource, DoT, Buff, percent proc and PPM proc",
      "APL recommendation change",
      "unavailable action rejection",
      "generic mechanism registry and controller branch audit",
      "Convoke 16-tick execution on 1/3/5 targets",
      "Ashamane's Guidance 60s cooldown / 3s channel / 12 ticks",
      "Convoke free finisher resource and tier-set interactions",
      "Convoke shuffled exceptional deck and Feral Frenzy pulses",
      "resolved SpellMisc FileDataID and local monitored-icon assets",
      "Thriving Growth accumulator with Green Thumb and active-DoT decay",
      "independent Bloodseeker Vines duration, period, stacking and expiry",
      "Implant gain/loss trigger and next single-target melee consumption",
      "Twin Sprouts replication and target selection on 1/3/5 targets",
      "Root Network aura stacks synchronized from active independent Bloodseeker Vines",
      "Bloodseeker-aware AoE APL recommendation change",
      "manifest-driven SimC equipment stat oracle generation",
      "MID1/MID2 tier-set identities generated from SimC DBC",
      "equipment-derived 2pc/4pc detection and season conflict reporting",
      "unknown equipment variants remain structured unsupported fields",
    ],
  },
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(outputFile.pathname);
