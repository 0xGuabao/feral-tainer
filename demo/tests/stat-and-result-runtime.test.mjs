import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildInputFromFixture, normalizeBuildInput } from "../core/build-input.js";
import { BuildResolver } from "../core/build-resolver.js";
import { InteractiveController } from "../core/interactive-controller.js";
import { BUILD_FIXTURES } from "../data/12.1/build-fixtures.js";
import { actionResultRollId } from "../runtime/action-result-resolver.js";
import { applySecondaryRatingDiminishingReturns } from "../core/stat-resolver.js";

const resolver = new BuildResolver();

async function createMid1Input() {
  const source = await readFile(
    new URL("../../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url),
    "utf8",
  );
  return normalizeBuildInput({
    kind: "simc-profile",
    id: "mid1-stat-runtime",
    profileText: source,
  });
}

test("12.1 secondary rating diminishing returns follows SimC curve 21024", () => {
  assert.equal(applySecondaryRatingDiminishingReturns(25), 25);
  assert.equal(applySecondaryRatingDiminishingReturns(35), 34.5);
  assert.equal(applySecondaryRatingDiminishingReturns(45), 43);
  assert.equal(applySecondaryRatingDiminishingReturns(70), 60);
  assert.equal(applySecondaryRatingDiminishingReturns(250), 126);
});

test("MID1 static equipment stats affect GCD, energy regeneration and DoT tick interval", async () => {
  const input = await createMid1Input();
  const profile = resolver.resolve(input);
  const controller = new InteractiveController({ defaultBuildInput: input });
  const started = controller.startSession({ buildInput: input, procMode: "scripted" });
  assert.equal(started.combatStats.hasteMultiplier, profile.combatStats.hasteMultiplier);

  const rake = controller.pressAction({ skillId: "rake" });
  const expectedGcd = 1000 / profile.combatStats.hasteMultiplier;
  const expectedPeriod = profile.actionById.rake.dot.periodMs / profile.combatStats.hasteMultiplier;
  assert.ok(Math.abs(rake.snapshot.gcd.remainingMs - expectedGcd) < 0.001);
  assert.ok(Math.abs(rake.snapshot.targets[0].dots.rake.periodMs - expectedPeriod) < 0.001);
  assert.equal(
    rake.snapshot.resources.energyRegenPerSecond,
    Math.round(profile.resources.energy.regenPerSecond * profile.combatStats.hasteMultiplier * 1000) / 1000,
  );
});

test("dynamic haste and regeneration auras affect subsequent timing without controller branches", () => {
  const input = buildInputFromFixture(BUILD_FIXTURES.userValidation);
  const profile = resolver.resolve(input);
  assert.ok(profile.effects.some((effect) => effect.id === "savageFury"));
  const controller = new InteractiveController({ defaultBuildInput: input });
  controller.startSession({ buildInput: input, procMode: "scripted" });
  controller.pressAction({ skillId: "tigersFury" });
  const rake = controller.pressAction({ skillId: "rake" });
  assert.equal(rake.snapshot.combatStats.currentHasteMultiplier, 1.1);
  assert.ok(Math.abs(rake.snapshot.gcd.remainingMs - (1000 / 1.1)) < 0.001);
  assert.ok(Math.abs(rake.snapshot.targets[0].dots.rake.periodMs - (profile.actionById.rake.dot.periodMs / 1.1)) < 0.001);
  assert.equal(
    rake.snapshot.resources.energyRegenPerSecond,
    Math.round(profile.resources.energy.regenPerSecond * 1.1 * 1.25 * 1000) / 1000,
  );
});

test("action results drive Primal Fury from actual crits and grant at most one point on AoE", () => {
  const input = buildInputFromFixture(BUILD_FIXTURES.primalWrath);
  const controller = new InteractiveController({ defaultBuildInput: input });
  controller.startSession({
    buildInput: input,
    targetCount: 5,
    procMode: "scripted",
    scriptedProcs: [{ effectId: actionResultRollId("swipe", 2), hook: "on_action_result" }],
  });
  const swipe = controller.pressAction({ skillId: "swipe" });
  const results = swipe.snapshot.eventHistory.filter(
    (event) => event.type === "ACTION_RESULT" && event.sourceSkillId === "swipe",
  );
  assert.equal(results.length, 5);
  assert.equal(results.filter((event) => event.metadata.crit).length, 1);
  assert.equal(swipe.snapshot.resources.comboPoints, 2);
  assert.equal(
    swipe.snapshot.eventHistory.filter(
      (event) => event.type === "RESOURCE_CHANGED" && event.reason === "primalFury",
    ).length,
    1,
  );
  assert.equal(swipe.snapshot.rng.scriptRemaining, 0);
  assert.equal(swipe.snapshot.rng.actionResults.scriptRemaining, 0);
});

test("a non-critical builder does not trigger Primal Fury", () => {
  const input = buildInputFromFixture(BUILD_FIXTURES.primalWrath);
  const controller = new InteractiveController({ defaultBuildInput: input });
  controller.startSession({ buildInput: input, procMode: "scripted" });
  const swipe = controller.pressAction({ skillId: "swipe" });
  assert.equal(swipe.snapshot.resources.comboPoints, 1);
  assert.equal(
    swipe.snapshot.eventHistory.some(
      (event) => event.type === "RESOURCE_CHANGED" && event.reason === "primalFury",
    ),
    false,
  );
});

test("fixed seeds produce stable action-result streams", () => {
  const input = buildInputFromFixture(BUILD_FIXTURES.userValidation);
  const run = () => {
    const controller = new InteractiveController({ defaultBuildInput: input });
    controller.startSession({ buildInput: input, procMode: "seeded", seed: 987654 });
    controller.pressAction({ skillId: "rake" });
    controller.advanceTime(1000);
    controller.pressAction({ skillId: "shred" });
    return controller.getSnapshot().eventHistory
      .filter((event) => event.type === "ACTION_RESULT")
      .map((event) => event.metadata);
  };
  assert.deepEqual(run(), run());
});

test("changing only crit chance changes result-driven resource triggers", () => {
  const input = buildInputFromFixture(BUILD_FIXTURES.primalWrath);
  const baseProfile = resolver.resolve(input);
  const runWithCrit = (critChance) => {
    const profile = structuredClone(baseProfile);
    profile.combatStats.critChance = critChance;
    profile.derivedStats.critChance = critChance;
    const controller = new InteractiveController({ defaultBuildInput: input });
    controller.startSession({ resolvedProfile: profile, targetCount: 1, procMode: "seeded", seed: 42 });
    return controller.pressAction({ skillId: "swipe" }).snapshot;
  };
  const neverCrit = runWithCrit(0);
  const alwaysCrit = runWithCrit(1);
  assert.equal(neverCrit.resources.comboPoints, 1);
  assert.equal(alwaysCrit.resources.comboPoints, 2);
  assert.equal(neverCrit.eventHistory.find((event) => event.type === "ACTION_RESULT").metadata.result, "hit");
  assert.equal(alwaysCrit.eventHistory.find((event) => event.type === "ACTION_RESULT").metadata.result, "crit");
});

test("haste-affected channels use the same generic haste multiplier", () => {
  const input = buildInputFromFixture(BUILD_FIXTURES.userValidation);
  const profile = structuredClone(resolver.resolve(input));
  profile.combatStats.hasteMultiplier = 1.25;
  profile.combatStats.hastePercent = 0.25;
  profile.derivedStats.hasteMultiplier = 1.25;
  profile.derivedStats.hastePercent = 0.25;
  profile.actionById.convoke.channel.hasteAffected = true;
  profile.actions.find((action) => action.id === "convoke").channel.hasteAffected = true;

  const controller = new InteractiveController({ defaultBuildInput: input });
  controller.startSession({ resolvedProfile: profile, procMode: "scripted" });
  const convoke = controller.pressAction({ skillId: "convoke" });
  assert.equal(convoke.snapshot.channel.durationMs, profile.actionById.convoke.channel.durationMs / 1.25);
  assert.equal(convoke.snapshot.channel.tickIntervalMs, profile.actionById.convoke.channel.tickMs / 1.25);
});
