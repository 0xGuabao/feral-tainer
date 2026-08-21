import { readFile } from "node:fs/promises";

import {
  APL_IR_OPERATORS,
  APL_IR_TARGET_KINDS,
  APL_IR_VALUE_KINDS,
} from "../../demo/apl/apl-ir.js";
import { buildInputFromFixture, normalizeBuildInput } from "../../demo/core/build-input.js";
import { BuildResolver } from "../../demo/core/build-resolver.js";
import { resolvedProfileDiff } from "../../demo/core/contracts.js";
import { InteractiveController } from "../../demo/core/interactive-controller.js";
import { BUILD_FIXTURES } from "../../demo/data/12.1/build-fixtures.js";
import { FERAL_APL_IR } from "../../demo/data/12.1/feral-apl-ir.js";
import { SIMC_VERSION_LOCK } from "../../demo/data/12.1/version.generated.js";

const resolver = new BuildResolver();
const TARGET_COUNTS = Object.freeze([1, 3, 5]);
const TRACE_DECISIONS = 20;

function traceBuild(fixtureKey, targetCount) {
  const buildInput = buildInputFromFixture(BUILD_FIXTURES[fixtureKey]);
  const controller = new InteractiveController({ defaultBuildInput: buildInput });
  controller.startSession({
    buildInput,
    targetCount,
    durationMs: 60000,
    procMode: "seeded",
    seed: 1210001,
  });

  const decisions = [];
  for (let index = 0; index < TRACE_DECISIONS; index += 1) {
    const before = controller.getSnapshot();
    if (before.session.status === "ended") break;
    const recommendation = controller.getRecommendation();
    const decision = {
      index,
      timestampMs: before.session.timestamp,
      ruleId: recommendation.ruleId,
      skillId: recommendation.skillId,
      targetIndex: recommendation.targetIndex,
      waitMs: recommendation.waitMs,
      energy: before.resources.energy,
      comboPoints: before.resources.comboPoints,
    };

    if (recommendation.skillId) {
      const result = controller.pressAction({
        skillId: recommendation.skillId,
        targetIndex: recommendation.targetIndex ?? before.activeTargetIndex,
      });
      decision.castOk = result.ok;
      decision.castCode = result.code ?? null;
      if (!result.ok) {
        controller.advanceTime(100);
      } else if (!result.snapshot.channel && result.snapshot.gcd.remainingMs > 0) {
        controller.advanceTime(Math.ceil(result.snapshot.gcd.remainingMs));
      }
    } else {
      decision.castOk = null;
      decision.castCode = null;
      controller.advanceTime(Math.max(1, recommendation.waitMs ?? 100));
    }
    decisions.push(decision);
  }

  const finalSnapshot = controller.getSnapshot();
  const recommendedSkillIds = [...new Set(decisions.map((entry) => entry.skillId).filter(Boolean))];
  return {
    fixtureKey,
    buildId: finalSnapshot.profile.id,
    targetCount,
    availableActionIds: finalSnapshot.catalog.actions.map((action) => action.id),
    recommendedSkillIds,
    unavailableRecommendations: recommendedSkillIds.filter(
      (skillId) => !finalSnapshot.catalog.actions.some((action) => action.id === skillId),
    ),
    decisions,
  };
}

function profileSummary(profile) {
  return {
    id: profile.id,
    actionIds: profile.actions.map((action) => action.id),
    aplRuleIds: profile.apl.rules.map((rule) => rule.id),
    filteredAplRules: profile.apl.filteredRules,
    unsupportedEffectCount: profile.unsupportedEffects.length,
    unsupportedAplRuleCount: profile.unsupportedAplRules.length,
  };
}

export async function buildAplIrAcceptance() {
  const user = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.userValidation));
  const primal = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.primalWrath));
  const source = await readFile(
    new URL("../../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url),
    "utf8",
  );
  const fullProfile = resolver.resolve(normalizeBuildInput({
    kind: "simc-profile",
    id: "g3-full-simc-profile",
    label: "G3 完整 SimC Profile APL 编译验收",
    profileText: source,
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
    source: "vendor/simc/profiles/MID1/MID1_Druid_Feral.simc",
  }));
  const diff = resolvedProfileDiff(user, primal);
  const traces = ["userValidation", "primalWrath"].flatMap((fixtureKey) =>
    TARGET_COUNTS.map((targetCount) => traceBuild(fixtureKey, targetCount)));

  return {
    schemaVersion: 1,
    purpose: "G3 controlled APL IR, exact Profile binding, 1/3/5 target reuse and zero-silent-drop evidence",
    versionLock: SIMC_VERSION_LOCK,
    ir: {
      schemaVersion: 1,
      ruleCount: FERAL_APL_IR.length,
      operators: APL_IR_OPERATORS,
      valueKinds: APL_IR_VALUE_KINDS,
      targetKinds: APL_IR_TARGET_KINDS,
      ruleIds: FERAL_APL_IR.map((rule) => rule.id),
    },
    builds: {
      userValidation: profileSummary(user),
      primalWrath: profileSummary(primal),
    },
    resolvedProfileDiff: {
      talentChanges: diff.talentChanges,
      actionChanges: diff.actionChanges,
      internalActionChanges: diff.internalActionChanges,
      effectChanges: diff.effectChanges,
      resourceChanges: diff.resourceChanges,
      combatStatChanges: diff.combatStatChanges,
      modifierChanges: diff.modifierChanges,
      unsupportedEffects: {
        left: user.unsupportedEffects.length,
        right: primal.unsupportedEffects.length,
      },
      unsupportedAplRules: {
        left: user.unsupportedAplRules.length,
        right: primal.unsupportedAplRules.length,
      },
    },
    traces,
    fullProfileApl: {
      profileRuleCount: fullProfile.apl.profileRuleCount,
      compiledRuleCount: fullProfile.apl.rules.length,
      filteredRuleCount: fullProfile.apl.filteredRules.length,
      unsupportedRuleCount: fullProfile.unsupportedAplRules.length,
      accountedProfileRuleCount: fullProfile.apl.accountedProfileRuleCount,
      compiledRules: fullProfile.apl.rules.map((rule) => ({
        ruleId: rule.id,
        actionId: rule.actionId,
        profileLineNumber: rule.profileSource.lineNumber,
      })),
      filteredRules: fullProfile.apl.filteredRules,
      unsupportedRules: fullProfile.unsupportedAplRules,
      remainingUnsupportedFieldKinds: Object.fromEntries(
        [...new Set(fullProfile.unsupportedFields.map((field) => field.fieldKind))]
          .sort()
          .map((kind) => [kind, fullProfile.unsupportedFields.filter((field) => field.fieldKind === kind).length]),
      ),
    },
    gates: {
      twoDifferentialBuilds: user.actionById.moonfire != null && primal.actionById.primalWrath != null,
      sameControllerForAllTraces: true,
      targetCountsCovered: [...new Set(traces.map((trace) => trace.targetCount))],
      unavailableRecommendationCount: traces.reduce(
        (total, trace) => total + trace.unavailableRecommendations.length,
        0,
      ),
      fullProfileAplAccountingDelta:
        fullProfile.apl.profileRuleCount - fullProfile.apl.accountedProfileRuleCount,
      actionListFieldsLeftInUnsupportedFields: fullProfile.unsupportedFields.filter(
        (field) => field.fieldKind === "action-list",
      ).length,
    },
  };
}
