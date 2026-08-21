import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FeralAPLAdapter } from "../apl/feral-apl-adapter.js";
import { buildInputFromFixture, normalizeBuildInput } from "../core/build-input.js";
import { BuildResolver } from "../core/build-resolver.js";
import { resolvedProfileDiff } from "../core/contracts.js";
import { InteractiveController } from "../core/interactive-controller.js";
import { decodeFeralTalentCode, encodeFeralTalentCode } from "../core/talent-decoder.js";
import { BUILD_FIXTURES } from "../data/12.1/build-fixtures.js";
import { DRUID_TALENT_TREE_12_1 } from "../data/12.1/druid-talent-tree.generated.js";
import { CUSTOM_HANDLER_DECLARATIONS, TALENT_EFFECT_COVERAGE } from "../data/12.1/feral-game-data.js";
import { GENERIC_EFFECT_MECHANISMS } from "../runtime/effect-runtime.js";
import { actionResultRollId } from "../runtime/action-result-resolver.js";

const resolver = new BuildResolver();
const userInput = buildInputFromFixture(BUILD_FIXTURES.userValidation);
const primalInput = buildInputFromFixture(BUILD_FIXTURES.primalWrath);
const createController = () => new InteractiveController({ defaultBuildInput: userInput });

function createTalentRankInput(token, rank) {
  const decoded = decodeFeralTalentCode(BUILD_FIXTURES.userValidation.talentCode);
  let remaining = rank;
  let matched = false;
  const selections = [];
  for (const selection of decoded.serializedSelections) {
    if (selection.token !== token) {
      selections.push(selection);
      continue;
    }
    matched = true;
    if (remaining <= 0) continue;
    const allocated = Math.min(selection.maxRanks, remaining);
    remaining -= allocated;
    selections.push({
      ...selection,
      rank: allocated,
      purchased: true,
      partial: allocated !== selection.maxRanks,
    });
  }
  assert.equal(matched, true, `fixture must contain talent '${token}'`);
  assert.equal(remaining, 0, `unable to allocate rank ${rank} for '${token}'`);
  return normalizeBuildInput({
    kind: "talent-code",
    id: `rank-fixture-${token}-${rank}`,
    talentCode: encodeFeralTalentCode(selections),
    setBonuses: BUILD_FIXTURES.userValidation.setBonuses,
  });
}

function createIncarnationGuidanceInput() {
  const decoded = decodeFeralTalentCode(BUILD_FIXTURES.simcWildstalker.talentCode);
  const incarnation = DRUID_TALENT_TREE_12_1.nodes
    .flatMap((node) => node.entries)
    .find((entry) => entry.name === "Incarnation: Avatar of Ashamane");
  const selections = decoded.selections.map((selection) => selection.token === "convoke_the_spirits"
    ? {
        ...incarnation,
        token: "incarnation_avatar_of_ashamane",
        rank: 1,
        purchased: true,
        partial: false,
        choiceIndex: 0,
      }
    : selection);
  return normalizeBuildInput({
    kind: "talent-code",
    id: "incarnation-guidance-tier-fixture",
    talentCode: encodeFeralTalentCode(selections),
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
  });
}

function createTwinSproutsInput() {
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
    id: "wildstalker-twin-sprouts-fixture",
    talentCode: encodeFeralTalentCode(selections),
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
  });
}

function createRootNetworkInput() {
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
    id: "wildstalker-root-network-fixture",
    talentCode: encodeFeralTalentCode(selections),
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
  });
}

test("TalentDecoder decodes and semantically round-trips real 12.1 export strings", () => {
  for (const fixture of Object.values(BUILD_FIXTURES)) {
    const decoded = decodeFeralTalentCode(fixture.talentCode);
    const roundTrip = decodeFeralTalentCode(encodeFeralTalentCode(decoded));
    const ranks = (value) => Object.fromEntries(Object.entries(value.byToken).map(([token, talent]) => [token, talent.rank]));
    assert.deepEqual(ranks(roundTrip), ranks(decoded));
    assert.equal(decoded.specializationId, 103);
    assert.match(decoded.treeHash, /^[0-9a-f]{32}$/);
    assert.equal(decoded.warnings.length, 0);
  }
  const userBuild = decodeFeralTalentCode(BUILD_FIXTURES.userValidation.talentCode);
  assert.equal(userBuild.byToken.unseen_predator.rank, 4);
  assert.deepEqual(userBuild.activeSubtreeIds, [22]);
  assert.equal(userBuild.byToken.fount_of_strength, undefined, "inactive Druid of the Claw selections must not affect the active build");
  assert.ok(userBuild.inactiveHeroSelections.some((entry) => entry.token === "fount_of_strength"));
});

test("BuildResolver derives action availability and profile diff from talents", () => {
  const user = resolver.resolve(userInput);
  const primal = resolver.resolve(primalInput);
  assert.ok(user.actionById.moonfire);
  assert.equal(user.actionById.primalWrath, undefined);
  assert.ok(primal.actionById.primalWrath);
  assert.equal(primal.actionById.moonfire, undefined);
  assert.equal(user.resources.energy.max, 140);
  assert.equal(user.resources.energy.regenPerSecond, 12.65);
  assert.equal(user.actionById.berserk.auras[0].durationMs, 25000);
  assert.equal(user.actionById.feralFrenzy.cooldownMs, 30000);
  assert.equal(user.actionById.rip.dot.durationFormula.multiplier, 0.8);
  assert.equal(user.combatStats.critChance, 0.325434782609);
  for (const action of user.actions) {
    assert.ok(action.icon?.fileDataId, `${action.id} must resolve a Blizzard FileDataID icon`);
    assert.match(action.icon.path, /^\.\/assets\/icons\/\d+\.jpg$/);
    assert.equal(
      existsSync(new URL(`../${action.icon.path.replace("./", "")}`, import.meta.url)),
      true,
      `${action.id} icon asset must exist locally`,
    );
  }
  for (const tracked of [...user.tracked.dots, ...user.tracked.auras]) {
    assert.ok(tracked.icon?.fileDataId, `${tracked.id} must resolve a real monitored icon`);
    assert.equal(
      existsSync(new URL(`../${tracked.icon.path.replace("./", "")}`, import.meta.url)),
      true,
      `${tracked.id} icon asset must exist locally`,
    );
  }
  assert.equal(user.actionById.tigersFury.icon.fileDataId, user.tracked.auras.find((aura) => aura.id === "tigersFury").icon.fileDataId);
  assert.equal(user.actionById.berserk.icon.fileDataId, user.tracked.auras.find((aura) => aura.id === "berserk").icon.fileDataId);

  const diff = resolvedProfileDiff(user, primal);
  assert.deepEqual(diff.actionChanges, [
    { id: "moonfire", leftEnabled: true, rightEnabled: false },
    { id: "primalWrath", leftEnabled: false, rightEnabled: true },
  ]);
  assert.ok(diff.talentChanges.some((entry) => entry.token === "lunar_inspiration"));
  assert.ok(diff.talentChanges.some((entry) => entry.token === "primal_wrath"));
  assert.ok(user.unsupportedEffects.every((entry) => entry.effectId && entry.reason && entry.sourceKind));
  assert.equal(user.unsupportedEffects.some((entry) => entry.effectId === "talent:convoke_the_spirits"), false);
  assert.equal(user.unsupportedEffects.some((entry) => entry.effectId === "talent:lycaras_teachings"), false);
  assert.equal(user.effects.some((entry) => entry.id === "twinSprouts"), false);
  assert.equal(user.effects.some((entry) => entry.id === "thrivingGrowth"), false);
  assert.equal(user.unsupportedEffects.some((entry) => entry.effectId === "talent:twin_sprouts"), false);
  assert.equal(user.unsupportedEffects.some((entry) => entry.effectId === "talent:green_thumb"), false);
  for (const selected of Object.values(user.build.talents.byToken).filter((entry) => entry.treeIndex !== 4)) {
    const coverage = TALENT_EFFECT_COVERAGE[selected.token];
    assert.ok(coverage, `selected talent '${selected.token}' must have a coverage classification`);
    assert.equal(
      user.unsupportedEffects.some((entry) => entry.effectId === `talent:${selected.token}`),
      coverage.status !== "supported",
      `selected talent '${selected.token}' must be supported or structurally unsupported`,
    );
  }
  assert.equal(user.internalActions.length, 10);
  assert.ok(user.internalActionById.convokeFerociousBite);
  assert.ok(user.tracked.dots.some((dot) => dot.id === "feralFrenzy"));
});

test("talent ranks resolve skill values and tiered mechanisms instead of acting as booleans", () => {
  const rankOneEnergy = resolver.resolve(createTalentRankInput("tireless_energy", 1));
  const rankTwoEnergy = resolver.resolve(userInput);
  assert.equal(rankOneEnergy.build.talents.byToken.tireless_energy.rank, 1);
  assert.equal(rankOneEnergy.resources.energy.max, 120);
  assert.equal(rankOneEnergy.resources.energy.regenPerSecond, 11.88);
  assert.equal(rankTwoEnergy.resources.energy.max, 140);
  assert.equal(rankTwoEnergy.resources.energy.regenPerSecond, 12.65);
  assert.deepEqual(
    rankTwoEnergy.resolvedModifiers.find((entry) => entry.effectId === "tirelessEnergy").talentRanks,
    [{ token: "tireless_energy", minimumRank: 1, selectedRank: 2 }],
  );

  const lycarasRankOne = resolver.resolve(createTalentRankInput("lycaras_teachings", 1));
  assert.equal(lycarasRankOne.combatStats.critChance, 0.295434782609);
  assert.equal(rankTwoEnergy.combatStats.critChance, 0.325434782609);
  assert.deepEqual(
    lycarasRankOne.resolvedModifiers.find((entry) => entry.effectId === "lycarasTeachingsCatCrit").talentRanks,
    [{ token: "lycaras_teachings", minimumRank: 1, selectedRank: 1 }],
  );
  const lycarasDiff = resolvedProfileDiff(lycarasRankOne, rankTwoEnergy);
  assert.deepEqual(lycarasDiff.combatStatChanges, [{
    path: "combatStats.critChance",
    left: 0.295434782609,
    right: 0.325434782609,
  }]);
  assert.ok(lycarasDiff.modifierChanges.some((entry) => entry.effectId === "lycarasTeachingsCatCrit"));

  const energyDiff = resolvedProfileDiff(rankOneEnergy, rankTwoEnergy);
  assert.deepEqual(energyDiff.resourceChanges, [
    { path: "resources.energy.initial", left: 120, right: 140 },
    { path: "resources.energy.max", left: 120, right: 140 },
    { path: "resources.energy.regenPerSecond", left: 11.88, right: 12.65 },
  ]);
  assert.ok(energyDiff.modifierChanges.some((entry) => entry.effectId === "tirelessEnergy"));

  const unseenRankOne = resolver.resolve(createTalentRankInput("unseen_predator", 1));
  assert.equal(unseenRankOne.build.talents.byToken.unseen_predator.rank, 1);
  assert.ok(unseenRankOne.effects.some((effect) => effect.id === "unseenPredatorBite"));
  assert.equal(unseenRankOne.effects.some((effect) => effect.id === "unseenPredatorStalking"), false);
  assert.ok(rankTwoEnergy.effects.some((effect) => effect.id === "unseenPredatorStalking"));
});

test("Pouncing Strikes, Strategic Infusion and rank-4 Unseen Predator follow SimC event order", () => {
  const pouncing = createController();
  pouncing.startSession({
    buildInput: userInput,
    targetCount: 1,
    procMode: "scripted",
    scriptedProcs: [{ effectId: actionResultRollId("shred", 0), hook: "on_action_result" }],
  });
  const shred = pouncing.pressAction({ skillId: "shred" });
  assert.equal(shred.snapshot.resources.comboPoints, 3, "Shred grants base, Pouncing and scripted Primal Fury points");
  assert.equal(shred.snapshot.auras.prowl, undefined);
  assert.equal(shred.snapshot.auras.strategicInfusion.remainingMs, 6000);
  assert.equal(
    shred.snapshot.eventHistory.find((event) => event.type === "ACTION_RESULT" && event.sourceSkillId === "shred").metadata.critChance,
    resolver.resolve(userInput).combatStats.critChance * 2,
  );

  for (const targetCount of [1, 3, 5]) {
    const stalking = createController();
    stalking.startSession({
      buildInput: userInput,
      targetCount,
      procMode: "scripted",
      scriptedProcs: [{ effectId: actionResultRollId("rake", 0), hook: "on_action_result" }],
    });
    stalking.pressAction({ skillId: "tigersFury" });
    const rake = stalking.pressAction({ skillId: "rake" });
    const primalRoll = rake.snapshot.eventHistory.find((event) => event.type === "ACTION_RESULT" && event.sourceSkillId === "rake");
    const unseenCast = rake.snapshot.eventHistory.find((event) => event.type === "INTERNAL_ACTION_CAST" && event.metadata?.handlerId === "feral_unseen_predator");
    assert.equal(primalRoll.metadata.critChance, resolver.resolve(userInput).combatStats.critChance + 0.08);
    assert.equal(rake.snapshot.auras.stalkingPredator.stacks, 1);
    assert.equal(rake.snapshot.auras.unseenPredatorsCraving.remainingMs, 5000);
    assert.equal(unseenCast.sourceSkillId, targetCount > 3 ? "unseenSwipe" : "unseenSlash");
  }
});

test("Ashamane's Guidance resolves Convoke to 60 seconds, 3 seconds and 12 ticks", () => {
  const profile = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.simcWildstalker));
  const convoke = profile.actionById.convoke;
  assert.equal(convoke.cooldownMs, 60000);
  assert.equal(convoke.channel.durationMs, 3000);
  assert.equal(convoke.channel.tickMs, 250);
  assert.equal(convoke.channel.tickCount, 12);
  assert.equal(convoke.channel.parameters.guidance, true);
  assert.equal(convoke.channel.parameters.exceptionalDeckSize, 2);
  assert.deepEqual(convoke.channel.parameters.offspecRange, [2.5, 7.5]);
  assert.equal(profile.unsupportedEffects.some((entry) => entry.effectId === "talent:ashamanes_guidance"), false);
  assert.equal(profile.unsupportedEffects.some((entry) => entry.effectId === "talent:green_thumb"), false);
  assert.equal(profile.unsupportedEffects.some((entry) => entry.effectId === "talent:resilient_flourishing"), false);
  assert.equal(profile.actionById.tigersFury.auras[0].durationMs, 15000);
  assert.deepEqual(
    profile.internalActions
      .filter((action) => action.id.startsWith("bloodseekerVines"))
      .map((action) => [action.id, action.dot.durationMs, action.dot.periodMs]),
    [
      ["bloodseekerVines", 6400, 1600],
      ["bloodseekerVinesImplant", 6000, 1600],
    ],
  );
  const bloodseeker = profile.tracked.dots.find((dot) => dot.id === "bloodseekerVines");
  assert.equal(bloodseeker.icon.fileDataId, 134197);
  assert.equal(existsSync(new URL(`../${bloodseeker.icon.path.replace("./", "")}`, import.meta.url)), true);
});

test("Wildstalker accumulator, Green Thumb, Implant and independent vine instances follow SimC values", () => {
  const input = buildInputFromFixture(BUILD_FIXTURES.simcWildstalker);
  const controller = createController();
  controller.startSession({
    buildInput: input,
    targetCount: 3,
    durationMs: 30000,
    procMode: "scripted",
    scriptedProcs: [{ effectId: "thrivingGrowth", hook: "on_dot_tick" }],
  });
  const fury = controller.pressAction({ skillId: "tigersFury" });
  assert.equal(fury.snapshot.auras.tigersFury.remainingMs, 15000, "Predator adds five seconds");
  assert.equal(fury.snapshot.auras.implant.remainingMs, 15000);

  const rake = controller.pressAction({ skillId: "rake" });
  assert.equal(rake.snapshot.auras.implant, undefined);
  assert.equal(rake.snapshot.targets[0].dots.bloodseekerVines.stacks, 1);
  assert.equal(rake.snapshot.targets[0].dots.bloodseekerVines.instances[0].baseDurationMs, 6000);
  assert.equal(
    rake.snapshot.eventHistory.find(
      (event) => event.type === "INTERNAL_ACTION_CAST" && event.sourceSkillId === "bloodseekerVinesImplant",
    ).metadata.originSkillId,
    "rake",
  );

  controller.advanceTime(2400);
  const grown = controller.getSnapshot();
  const accumulator = grown.eventHistory.find(
    (event) => event.type === "PROC_ACCUMULATOR" && event.effectId === "thrivingGrowth",
  );
  assert.equal(accumulator.metadata.scale, 135);
  assert.equal(accumulator.metadata.talentMultiplier, 1.2);
  assert.equal(accumulator.metadata.raw, 162);
  assert.equal(grown.mechanics.bloodseekerVinesGrowth.triggerCount, 1);
  assert.equal(grown.targets[0].dots.bloodseekerVines.stacks, 2);
  assert.deepEqual(
    grown.targets[0].dots.bloodseekerVines.instances.map((instance) => instance.baseDurationMs).sort((a, b) => a - b),
    [6000, 6400],
  );

  controller.advanceTime(12600);
  const expiredFury = controller.getSnapshot();
  assert.equal(expiredFury.auras.tigersFury, undefined);
  assert.equal(expiredFury.auras.implant.remainingMs, 15000, "losing Tiger's Fury grants Implant again");
  assert.equal(expiredFury.targets.every((target) => target.dots.bloodseekerVines == null), true);
});

test("Twin Sprouts duplicates only normal vines and selects targets generically on 1/3/5 targets", () => {
  const input = createTwinSproutsInput();
  const twinProfile = resolver.resolve(input);
  const implantProfile = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.simcWildstalker));
  const diff = resolvedProfileDiff(implantProfile, twinProfile);
  assert.ok(diff.effectChanges.some((entry) => entry.id === "implant" && entry.leftEnabled && !entry.rightEnabled));
  assert.ok(diff.effectChanges.some((entry) => entry.id === "twinSprouts" && !entry.leftEnabled && entry.rightEnabled));
  assert.ok(diff.internalActionChanges.some((entry) => entry.id === "bloodseekerVinesImplant"));
  assert.ok(diff.internalActionChanges.some((entry) => entry.id === "bloodseekerVinesTwin"));
  assert.equal(twinProfile.unsupportedEffects.some((entry) => [
    "talent:thriving_growth",
    "talent:twin_sprouts",
    "talent:green_thumb",
    "talent:resilient_flourishing",
  ].includes(entry.effectId)), false);

  for (const targetCount of [1, 3, 5]) {
    const controller = createController();
    controller.startSession({
      buildInput: input,
      targetCount,
      durationMs: 20000,
      procMode: "scripted",
      scriptedProcs: [
        { effectId: "thrivingGrowth", hook: "on_dot_tick" },
        { effectId: "twinSprouts", hook: "on_action_cast" },
      ],
    });
    controller.pressAction({ skillId: "rake" });
    controller.advanceTime(2400);
    const snapshot = controller.getSnapshot();
    assert.deepEqual(
      snapshot.targets.map((target) => target.dots.bloodseekerVines?.stacks ?? 0),
      targetCount === 1 ? [2] : [1, 1, ...Array(targetCount - 2).fill(0)],
    );
    assert.equal(snapshot.auras.implant, undefined);
    assert.equal(
      snapshot.eventHistory.filter(
        (event) => event.type === "INTERNAL_ACTION_CAST" && event.sourceSkillId === "bloodseekerVinesTwin",
      ).length,
      1,
    );
    controller.advanceTime(6400);
    assert.equal(controller.getSnapshot().targets.every((target) => target.dots.bloodseekerVines == null), true);
  }
});

test("Root Network synchronizes one aura stack per active independent vine without a talent-name branch", () => {
  const input = createRootNetworkInput();
  const profile = resolver.resolve(input);
  const rootEffect = profile.effects.find((effect) => effect.id === "rootNetwork");
  const rootAura = profile.tracked.auras.find((aura) => aura.id === "rootNetwork");
  const unsupported = profile.unsupportedEffects.find((effect) => effect.effectId === "talent:root_network");

  assert.equal(profile.build.talents.byToken.root_network.rank, 1);
  assert.equal(profile.build.talents.byToken.resilient_flourishing, undefined);
  assert.equal(rootEffect.mechanism, "aura_sync");
  assert.equal(rootEffect.triggers[0].hook, "on_dot_state_change");
  assert.equal(rootAura.icon.iconName, "ability_creature_poison_04");
  assert.equal(existsSync(new URL(`../${rootAura.icon.path.replace("./", "")}`, import.meta.url)), true);
  assert.equal(unsupported.impact, "damage-only");
  assert.match(unsupported.reason, /Buff 层数和生命周期已实现/);

  const controller = createController();
  controller.startSession({
    buildInput: input,
    targetCount: 3,
    durationMs: 20000,
    procMode: "scripted",
    scriptedProcs: [{ effectId: "thrivingGrowth", hook: "on_dot_tick" }],
  });
  controller.pressAction({ skillId: "tigersFury" });
  const rake = controller.pressAction({ skillId: "rake" });
  assert.equal(rake.snapshot.targets[0].dots.bloodseekerVines.stacks, 1);
  assert.equal(rake.snapshot.auras.rootNetwork.stacks, 1);
  assert.equal(rake.snapshot.auras.rootNetwork.remainingMs, 4001);

  controller.advanceTime(2400);
  const grown = controller.getSnapshot();
  assert.equal(grown.targets[0].dots.bloodseekerVines.stacks, 2);
  assert.equal(grown.auras.rootNetwork.stacks, 2);

  controller.advanceTime(1600);
  const decremented = controller.getSnapshot();
  assert.equal(decremented.targets[0].dots.bloodseekerVines.stacks, 1);
  assert.equal(decremented.auras.rootNetwork.stacks, 1);
  assert.ok(decremented.eventHistory.some(
    (event) => event.type === "AURA_REFRESHED" && event.effectId === "rootNetwork" && event.after?.stacks === 1,
  ));

  controller.advanceTime(Math.ceil(decremented.auras.rootNetwork.remainingMs) + 1);
  const expired = controller.getSnapshot();
  assert.equal(expired.targets.every((target) => target.dots.bloodseekerVines == null), true);
  assert.equal(expired.auras.rootNetwork, undefined);
});

test("APL reads resolved actions and DoT snapshots when Bloodseeker Vines changes the AoE finisher", () => {
  const profile = resolver.resolve(primalInput);
  const adapter = new FeralAPLAdapter(profile);
  const createView = (withVines) => ({
    status: "running",
    channel: null,
    nowMs: 10000,
    targetCount: 3,
    activeTargetIndex: 0,
    energy: 100,
    maxEnergy: 100,
    comboPoints: 5,
    fightRemainingMs: 50000,
    energyRegenPerSecond: 11,
    lastGcdActionId: "swipe",
    targets: [0, 1, 2].map((index) => ({
      index,
      dots: {
        rip: { remainingMs: 10000 + index * 1000, pandemicThresholdMs: 3000 },
        bloodseekerVines: withVines && index === 0
          ? { remainingMs: 6000, pandemicThresholdMs: 0, stackingMode: "independent" }
          : null,
      },
    })),
    hasAura: () => false,
    auraRemaining: () => 0,
    cooldownRemaining: () => 60000,
    dotRemaining: (dot) => dot?.remainingMs ?? 0,
    dotRefreshable: (dot) => !dot || dot.remainingMs <= dot.pandemicThresholdMs,
    effectiveCost: (action) => action.cost ?? 0,
  });

  assert.equal(adapter.recommend(createView(false)).skillId, "primalWrath");
  const vineRecommendation = adapter.recommend(createView(true));
  assert.equal(vineRecommendation.skillId, "ferociousBite");
  assert.match(vineRecommendation.reason, /血棘藤蔓/);
});

test("4pc extends Incarnation and its Guidance branch grants 750ms of 2pc duration per combo point", () => {
  const incarnationInput = createIncarnationGuidanceInput();
  const profile = resolver.resolve(incarnationInput);
  assert.equal(profile.actionById.berserk, undefined);
  assert.equal(profile.actionById.convoke, undefined);
  assert.equal(profile.actionById.incarnation.cooldownMs, 120000);
  assert.equal(profile.actionById.incarnation.auras[0].durationMs, 30000);
  assert.ok(profile.effects.some((effect) => effect.id === "mid2Feral2pcIncarnationGuidance"));
  assert.equal(profile.effects.some((effect) => effect.id === "mid2Feral2pc"), false);

  const controller = createController();
  controller.startSession({ buildInput: incarnationInput, targetCount: 1 });
  assert.equal(controller.pressAction({ skillId: "incarnation" }).ok, true);
  assert.equal(controller.pressAction({ skillId: "feralFrenzy" }).ok, true);
  controller.advanceTime(1000);
  const rip = controller.pressAction({ skillId: "rip" });
  assert.equal(rip.ok, true);
  assert.equal(rip.snapshot.counters.halazzisFuryDurationMs, 3750);
});

test("talent-only and full SimC inputs normalize into the same ResolvedProfile contract", () => {
  const fixture = BUILD_FIXTURES.userValidation;
  const simcInput = normalizeBuildInput({
    kind: "simc-profile",
    id: fixture.id,
    setBonuses: fixture.setBonuses,
    profileText: `druid=ArchitectureFixture\nspec=feral\ntalents=${fixture.talentCode}\n`,
  });
  const fromTalent = resolver.resolve(userInput);
  const fromSimc = resolver.resolve(simcInput);
  assert.equal(fromSimc.source.hasFullSimcProfile, true);
  assert.deepEqual(fromSimc.actions.map((action) => action.id), fromTalent.actions.map((action) => action.id));
  assert.deepEqual(fromSimc.build.talents.byToken, fromTalent.build.talents.byToken);
});

test("InteractiveController keeps one interface while switching builds", () => {
  const controller = createController();
  const methods = ["startSession", "pressAction", "advanceTime", "setActiveTarget", "getSnapshot", "getRecommendation", "drainEvents", "resetSession"];
  for (const method of methods) assert.equal(typeof controller[method], "function");

  controller.startSession({ buildInput: userInput, targetCount: 3 });
  assert.equal(controller.pressAction({ skillId: "primalWrath" }).ok, false);
  assert.equal(controller.getRecommendation().skillId, "tigersFury");
  controller.pressAction({ skillId: "tigersFury" });
  controller.pressAction({ skillId: "berserk" });
  controller.pressAction({ skillId: "feralFrenzy" });
  controller.advanceTime(1000);
  assert.equal(controller.getRecommendation().skillId, "rip");

  controller.startSession({ buildInput: primalInput, targetCount: 3 });
  assert.equal(controller.pressAction({ skillId: "moonfire" }).ok, false);
  assert.equal(controller.getRecommendation().skillId, "tigersFury");
  controller.pressAction({ skillId: "tigersFury" });
  controller.pressAction({ skillId: "berserk" });
  controller.pressAction({ skillId: "feralFrenzy" });
  controller.advanceTime(1000);
  assert.equal(controller.getRecommendation().skillId, "primalWrath");
  const result = controller.pressAction({ skillId: "primalWrath" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.targets.map((target) => target.dots.rip.remainingMs), [9600, 9600, 9600]);
});

test("resource, DoT, Buff and deterministic percent/PPM procs run through generic effects", () => {
  const controller = createController();
  controller.startSession({
    buildInput: userInput,
    targetCount: 1,
    procMode: "scripted",
    scriptedProcs: [
      { effectId: "franticMomentum", hook: "on_finisher" },
      { effectId: "suddenAmbush", hook: "on_finisher" },
      { effectId: "clearcasting", hook: "on_auto_attack" },
    ],
  });
  controller.pressAction({ skillId: "tigersFury" });
  controller.pressAction({ skillId: "berserk" });
  controller.pressAction({ skillId: "feralFrenzy" });
  controller.advanceTime(1000);
  const rip = controller.pressAction({ skillId: "rip" });
  assert.equal(rip.snapshot.resources.comboPoints, 1, "Tiger's Tenacity restores one combo point");
  assert.equal(rip.snapshot.targets[0].dots.rip.remainingMs, 19200);
  assert.equal(rip.snapshot.auras.franticMomentum.remainingMs, 6000);
  assert.equal(rip.snapshot.auras.suddenAmbush.remainingMs, 15000);
  assert.equal(rip.snapshot.counters.halazzisFuryDurationMs, 5000);

  controller.advanceTime(1000);
  assert.equal(controller.getSnapshot().auras.clearcasting.stacks, 1);
  const energyBeforeShred = controller.getSnapshot().resources.energy;
  controller.pressAction({ skillId: "shred" });
  assert.equal(controller.getSnapshot().resources.energy, energyBeforeShred);
  assert.equal(controller.getSnapshot().auras.clearcasting, undefined);

  controller.advanceTime(23000);
  assert.equal(controller.getSnapshot().auras.halazzisFury.remainingMs, 5000);
  assert.equal(controller.getSnapshot().counters.halazzisFuryDurationMs, 0);
  assert.ok(controller.getSnapshot().eventHistory.some((event) => event.type === "DOT_TICK"));
  assert.ok(controller.getSnapshot().eventHistory.some((event) => event.type === "PROC_ROLL"));
});

test("Convoke executes a haste-independent 16-tick cat-form sequence on 1/3/5 targets", () => {
  for (const targetCount of [1, 3, 5]) {
    const controller = createController();
    const cast = controller.startSession({
      buildInput: userInput,
      targetCount,
      durationMs: 10000,
      seed: 1210001,
    });
    assert.equal(cast.catalog.actions.find((action) => action.id === "convoke").channel.hasteAffected, false);
    const result = controller.pressAction({ skillId: "convoke" });
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.channel.totalTicks, 16);
    assert.equal(result.snapshot.channel.tickIntervalMs, 250);

    controller.advanceTime(3999);
    assert.equal(controller.getSnapshot().channel.ticksCompleted, 15);
    controller.advanceTime(1);
    const snapshot = controller.getSnapshot();
    const internalCasts = snapshot.eventHistory.filter((event) => event.type === "INTERNAL_ACTION_CAST");
    assert.equal(snapshot.channel, null);
    assert.equal(internalCasts.length, 16);
    assert.deepEqual(internalCasts.map((event) => event.timestamp), Array.from({ length: 16 }, (_, index) => (index + 1) * 250));
    assert.ok(internalCasts.every((event) => event.targetIndex == null || event.targetIndex < targetCount));
    assert.ok(internalCasts.filter((event) => event.sourceSkillId === "convokeFerociousBite").every((event) => event.targetIndex === 0));

    const rakeTargets = internalCasts.filter((event) => event.sourceSkillId === "convokeRake").map((event) => event.targetIndex);
    const moonfireTargets = internalCasts.filter((event) => event.sourceSkillId === "convokeMoonfire").map((event) => event.targetIndex);
    assert.equal(new Set(rakeTargets).size, rakeTargets.length, "active Rake must convert subsequent selections to Shred");
    assert.equal(new Set(moonfireTargets).size, moonfireTargets.length, "active Lunar Inspiration must convert subsequent selections to Wrath");
    assert.equal(snapshot.metrics.totalCasts, 1, "secondary actions must not count as player input");
    assert.equal(snapshot.actionHistory.length, 1, "secondary actions must not pollute the user cast sequence");
  }
});

test("Convoke free Bites use five effective combo points without consuming player resources", () => {
  const controller = createController();
  controller.startSession({ buildInput: userInput, targetCount: 1, durationMs: 20000, seed: 1210001 });
  controller.pressAction({ skillId: "tigersFury" });
  controller.pressAction({ skillId: "berserk" });
  controller.pressAction({ skillId: "feralFrenzy" });
  controller.advanceTime(1000);
  controller.pressAction({ skillId: "rip" });
  const initialTierCounter = controller.getSnapshot().counters.halazzisFuryDurationMs;
  controller.advanceTime(1000);
  controller.pressAction({ skillId: "convoke" });
  controller.advanceTime(4000);

  const snapshot = controller.getSnapshot();
  const bites = snapshot.eventHistory.filter(
    (event) => event.type === "INTERNAL_ACTION_CAST" && event.sourceSkillId === "convokeFerociousBite",
  );
  assert.ok(bites.length > 0);
  for (const bite of bites) {
    assert.equal(bite.metadata.comboSpent, 0);
    assert.equal(bite.metadata.effectiveComboPoints, 5);
    assert.ok(bite.after.comboPoints >= bite.before.comboPoints, "free Bite must not spend actual combo points");
    assert.ok(bite.after.energy >= bite.before.energy, "free Bite must not spend energy");
  }
  assert.equal(
    snapshot.counters.halazzisFuryDurationMs,
    initialTierCounter + bites.length * 5000,
    "each free five-point Bite must feed the 2pc finisher counter",
  );
});

test("Convoke exceptional casts use a one-in-five shuffled deck and Feral Frenzy pulses", () => {
  const controller = createController();
  controller.startSession({ buildInput: userInput, targetCount: 1, durationMs: 610000, seed: 1210001 });
  for (let index = 0; index < 5; index += 1) {
    assert.equal(controller.pressAction({ skillId: "convoke" }).ok, true);
    controller.advanceTime(4000);
    if (index < 4) controller.advanceTime(116000);
  }
  controller.advanceTime(1000);
  const snapshot = controller.getSnapshot();
  const starts = snapshot.eventHistory.filter(
    (event) => event.type === "CUSTOM_MECHANIC_STARTED" && event.metadata.handlerId === "feral_convoke",
  );
  const exceptional = snapshot.eventHistory.filter(
    (event) => event.type === "INTERNAL_ACTION_CAST" && event.sourceSkillId === "convokeFeralFrenzy",
  );
  const pulses = snapshot.eventHistory.filter(
    (event) => event.type === "INTERNAL_ACTION_PULSE" && event.sourceSkillId === "convokeFeralFrenzy",
  );
  assert.equal(starts.length, 5);
  assert.equal(starts.filter((event) => event.metadata.exceptional).length, 1);
  assert.equal(exceptional.length, 1);
  assert.equal(pulses.length, 5);
});

test("generic mechanism registry is explicit and controller has no talent-name branches", async () => {
  const required = [
    "on_session_start", "on_action_impact", "on_action_result", "on_action_cast", "on_builder", "on_finisher", "on_combo_overcap", "on_dot_tick",
    "on_aura_tick", "on_channel_start", "on_channel_tick", "resource_overflow_buffer",
    "percent_proc", "ppm", "rppm", "internal_cooldown", "aura_stack", "aura_refresh",
    "aura_consume", "combat_stat_modifier", "modify_duration", "replace_action", "accumulator_proc",
    "execute_internal_action", "independent_dot", "target_selector",
  ];
  for (const mechanism of required) assert.ok(GENERIC_EFFECT_MECHANISMS.includes(mechanism));
  assert.deepEqual(CUSTOM_HANDLER_DECLARATIONS.map((entry) => entry.id), ["feral_convoke", "feral_unseen_predator"]);

  const source = await readFile(new URL("../core/interactive-controller.js", import.meta.url), "utf8");
  for (const forbidden of ["lunar_inspiration", "primal_wrath", "sudden_ambush", "frantic_momentum", "convoke_the_spirits", "unseen_predator", "strategic_infusion", "pouncing_strikes", "thriving_growth", "twin_sprouts", "implant", "green_thumb", "resilient_flourishing"]) {
    assert.equal(source.includes(forbidden), false, `controller must not branch on talent '${forbidden}'`);
  }
  assert.equal(source.includes("build-fixtures"), false, "generic controller must not import validation fixtures");
  assert.equal(typeof new FeralAPLAdapter(resolver.resolve(userInput)).recommend, "function");
});
