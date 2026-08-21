import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildInputFromFixture, normalizeBuildInput } from "../core/build-input.js";
import { BuildResolver } from "../core/build-resolver.js";
import { InteractiveController } from "../core/interactive-controller.js";
import { applySecondaryRatingDiminishingReturns } from "../core/stat-resolver.js";
import { BUILD_FIXTURES } from "../data/12.1/build-fixtures.js";

const resolver = new BuildResolver();

async function createMid1Input() {
  const profileText = await readFile(
    new URL("../../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url),
    "utf8",
  );
  return normalizeBuildInput({
    kind: "simc-profile",
    id: "mid1-item-runtime",
    profileText,
  });
}

test("equipment variants enable item actions/effects without leaking into talent-only builds", async () => {
  const mid1Input = await createMid1Input();
  const equipped = resolver.resolve(mid1Input);
  const talentOnlyInput = buildInputFromFixture(BUILD_FIXTURES.simcWildstalker);
  const talentOnly = resolver.resolve(talentOnlyInput);

  assert.equal(equipped.actionById.algetharPuzzleBox.itemId, 193701);
  assert.deepEqual(
    equipped.effects.filter((effect) => effect.id.startsWith("item")).map((effect) => effect.id),
    [
      "item244576ArcanoweaveInsight",
      "item251513LoaWorshipersBand",
      "item249343EssenceGenerator",
      "item249343AlnsightDriver",
      "item193701PuzzleMastery",
    ],
  );
  assert.equal(talentOnly.actionById.algetharPuzzleBox, undefined);
  assert.equal(talentOnly.effects.some((effect) => effect.id.startsWith("item")), false);

  const controller = new InteractiveController({ defaultBuildInput: talentOnlyInput });
  controller.startSession({ buildInput: talentOnlyInput, procMode: "scripted" });
  const blocked = controller.pressAction({ skillId: "algetharPuzzleBox" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockedCode, "build-unavailable");
});

test("Puzzle Box channels, starts shared cooldown and grants the verified mastery rating on completion", async () => {
  const input = await createMid1Input();
  const profile = structuredClone(resolver.resolve(input));
  const sharedAction = {
    id: "testSharedOnUse",
    name: "共享冷却测试动作",
    shortName: "测",
    kind: "item",
    trackingGroup: "item-cooldown",
    cooldownGroup: "onUseTrinket",
    cooldownGroupMs: 20000,
    offGcd: true,
    resultModel: { enabled: false },
  };
  profile.actions.push(sharedAction);
  profile.actionById[sharedAction.id] = sharedAction;
  const controller = new InteractiveController({ defaultBuildInput: input });
  const started = controller.startSession({ resolvedProfile: profile, procMode: "scripted" });
  const baseMasteryPoints = started.combatStats.masteryPoints;

  const cast = controller.pressAction({ skillId: "algetharPuzzleBox" });
  assert.equal(cast.ok, true);
  assert.ok(
    Math.abs(cast.snapshot.channel.durationMs - (2000 / profile.combatStats.hasteMultiplier)) < 0.001,
  );
  assert.equal(cast.snapshot.cooldownGroups.onUseTrinket.remainingMs, 20000);

  controller.advanceTime(cast.snapshot.channel.remainingMs);
  const completed = controller.getSnapshot();
  assert.equal(completed.channel, null);
  assert.equal(completed.auras.algetharPuzzleMastery.remainingMs, 20000);
  const expectedMasteryPoints = 8 + applySecondaryRatingDiminishingReturns((1037 + 861) / 46);
  assert.ok(Math.abs(completed.combatStats.masteryPoints - expectedMasteryPoints) < 1e-9);
  assert.ok(completed.combatStats.masteryPoints > baseMasteryPoints);

  const sharedBlocked = controller.pressAction({ skillId: "testSharedOnUse" });
  assert.equal(sharedBlocked.ok, false);
  assert.equal(sharedBlocked.blockedCode, "shared-cooldown");
});

test("Gaze uses scripted RPPM, 750ms ICD and independently expiring agility stacks", async () => {
  const input = await createMid1Input();
  const profile = structuredClone(resolver.resolve(input));
  profile.effects.find((effect) => effect.id === "item249343EssenceGenerator").triggers =
    profile.effects.find((effect) => effect.id === "item249343EssenceGenerator").triggers
      .filter((trigger) => trigger.hook === "on_action_result");
  profile.effects.find((effect) => effect.id === "item249343AlnsightDriver").triggers =
    profile.effects.find((effect) => effect.id === "item249343AlnsightDriver").triggers
      .filter((trigger) => trigger.hook === "on_action_result");
  const controller = new InteractiveController({ defaultBuildInput: input });
  controller.startSession({
    resolvedProfile: profile,
    procMode: "scripted",
    scriptedProcs: [{ effectId: "item249343AlnsightDriver", hook: "on_action_result" }],
  });

  const first = controller.pressAction({ skillId: "rake" }).snapshot;
  assert.equal(first.auras.alnsight.stacks, 1);
  assert.equal(first.auras.alnscornedEssence, undefined, "proc event must not also add essence");

  controller.advanceTime(first.gcd.remainingMs);
  const second = controller.pressAction({ skillId: "shred" }).snapshot;
  assert.equal(second.auras.alnscornedEssence.stacks, 1);
  assert.equal(second.auras.alnscornedEssence.stackingMode, "independent");
  assert.equal(second.auras.alnscornedEssence.stackExpiries.length, 1);
  assert.equal(second.combatStats.agility, 1868 + 27);
  assert.equal(second.combatStats.attackPower, 1868 + 27);

  controller.advanceTime(second.gcd.remainingMs);
  const third = controller.pressAction({ skillId: "shred" }).snapshot;
  assert.equal(third.auras.alnscornedEssence.stacks, 2);
  assert.equal(third.auras.alnscornedEssence.stackExpiries.length, 2);
  assert.equal(third.combatStats.agility, 1868 + (27 * 2));

  const firstExpiry = third.auras.alnscornedEssence.stackExpiries[0];
  controller.advanceTime(firstExpiry - third.session.timestamp);
  const partiallyExpired = controller.getSnapshot();
  assert.equal(partiallyExpired.auras.alnscornedEssence.stacks, 1);
  assert.equal(partiallyExpired.combatStats.agility, 1868 + 27);
});

test("Arcanoweave and Acuity use the shared RPPM aura runtime with verified agility values", async () => {
  const input = await createMid1Input();
  const cases = [
    {
      effectId: "item244576ArcanoweaveInsight",
      auraId: "arcanoweaveInsight",
      durationMs: 20000,
      agility: 43,
    },
    {
      effectId: "enchant8039AcuityOfTheRendorei",
      auraId: "mightOfTheVoid",
      durationMs: 15000,
      agility: 66,
    },
  ];

  for (const expected of cases) {
    const controller = new InteractiveController({ defaultBuildInput: input });
    const started = controller.startSession({
      buildInput: input,
      procMode: "scripted",
      scriptedProcs: [{ effectId: expected.effectId, hook: "on_action_result" }],
    });
    const cast = controller.pressAction({ skillId: "rake" }).snapshot;
    assert.equal(cast.auras[expected.auraId].remainingMs, expected.durationMs);
    assert.equal(cast.combatStats.agility, started.combatStats.agility + expected.agility);
    assert.equal(cast.combatStats.attackPower, started.combatStats.attackPower + expected.agility);
  }
});

test("Loa ring selects Capybara or Akil'zon through generic weighted random choice", async () => {
  const input = await createMid1Input();
  const cases = [
    { seed: 1210001, auraId: "blessingOfTheCapybara", otherAuraId: "akilzonsCryOfVictory" },
    { seed: 1, auraId: "akilzonsCryOfVictory", otherAuraId: "blessingOfTheCapybara" },
  ];

  for (const expected of cases) {
    const controller = new InteractiveController({ defaultBuildInput: input });
    const started = controller.startSession({
      buildInput: input,
      procMode: "scripted",
      seed: expected.seed,
      scriptedProcs: [{ effectId: "item251513LoaWorshipersBand", hook: "on_action_result" }],
    });
    const cast = controller.pressAction({ skillId: "rake" }).snapshot;
    assert.equal(cast.auras[expected.auraId].remainingMs, 15000);
    assert.equal(cast.auras[expected.otherAuraId], undefined);
    assert.equal(
      cast.eventHistory.some((event) =>
        event.type === "RANDOM_CHOICE_SELECTED" &&
        event.effectId === "item251513LoaWorshipersBand"),
      true,
    );
    if (expected.auraId === "blessingOfTheCapybara") {
      assert.equal(cast.combatStats.agility, started.combatStats.agility + 54);
    } else {
      assert.ok(cast.combatStats.hasteMultiplier > started.combatStats.hasteMultiplier);
    }
  }
});

test("RPPM bad-luck protection accumulates through generic auto-attack attempts", async () => {
  const input = await createMid1Input();
  const controller = new InteractiveController({ defaultBuildInput: input });
  controller.startSession({ buildInput: input, durationMs: 70000, procMode: "scripted" });
  controller.advanceTime(50000);
  const rolls = controller.getSnapshot().eventHistory.filter(
    (event) => event.type === "PROC_ROLL" && event.effectId === "item249343AlnsightDriver",
  );
  assert.ok(rolls.length > 20);
  assert.ok(rolls.some((event) => event.metadata.badLuckMultiplier > 1));
  assert.ok(rolls.every((event) => event.metadata.intervalMs <= 3500));
});

test("unverified item levels stay disabled and structured as unsupported", () => {
  const profileText = [
    "druid=UnverifiedPuzzle",
    "spec=feral",
    `talents=${BUILD_FIXTURES.simcWildstalker.talentCode}`,
    "trinket1=algethar_puzzle_box,id=193701,ilevel=288",
  ].join("\n");
  const profile = resolver.resolve(normalizeBuildInput({ kind: "simc-profile", profileText }));
  assert.equal(profile.actionById.algetharPuzzleBox, undefined);
  assert.equal(
    profile.itemEffects.find((effect) => effect.sourceId === 193701).status,
    "unsupported",
  );
  assert.equal(
    profile.unsupportedEffects.some((effect) => effect.effectId === "item:193701:special-effect"),
    true,
  );
});

test("item and aura icons resolve to real local assets", async () => {
  const input = await createMid1Input();
  const profile = resolver.resolve(input);
  const root = new URL("../", import.meta.url);
  const catalogEntries = [
    profile.actionById.algetharPuzzleBox,
    profile.tracked.auras.find((aura) => aura.id === "algetharPuzzleMastery"),
    profile.tracked.auras.find((aura) => aura.id === "alnsight"),
    profile.tracked.auras.find((aura) => aura.id === "alnscornedEssence"),
    profile.tracked.auras.find((aura) => aura.id === "arcanoweaveInsight"),
    profile.tracked.auras.find((aura) => aura.id === "mightOfTheVoid"),
    profile.tracked.auras.find((aura) => aura.id === "blessingOfTheCapybara"),
    profile.tracked.auras.find((aura) => aura.id === "akilzonsCryOfVictory"),
  ];
  for (const entry of catalogEntries) {
    assert.ok(entry.icon.fileDataId || entry.icon.iconName);
    const assetUrl = new URL(entry.icon.path.replace("./", ""), root);
    assert.equal(existsSync(assetUrl), true, `${entry.id} icon asset must exist`);
    assert.ok(readFileSync(assetUrl).length > 100);
  }
});
