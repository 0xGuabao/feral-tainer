import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildInputFromFixture, normalizeBuildInput } from "../core/build-input.js";
import { BuildResolver } from "../core/build-resolver.js";
import { resolvedProfileDiff } from "../core/contracts.js";
import { createLegacyRuntimeProfile } from "../core/resolved-profile-compat.js";
import { BUILD_FIXTURES } from "../data/12.1/build-fixtures.js";

const resolver = new BuildResolver();

test("ResolvedProfile v2 gives talent-only and full SimC inputs the same stable namespaces", async () => {
  const source = await readFile(
    new URL("../../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url),
    "utf8",
  );
  const fullInput = normalizeBuildInput({
    kind: "simc-profile",
    id: "mid1-full-profile",
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
    profileText: source,
  });
  const full = resolver.resolve(fullInput);
  const talentOnly = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.simcWildstalker));

  for (const profile of [full, talentOnly]) {
    assert.equal(profile.schemaVersion, 2);
    assert.equal(profile.character.class.token, "druid");
    assert.equal(profile.character.specialization.id, 103);
    assert.ok(Array.isArray(profile.equipment.slots));
    assert.ok(profile.baseStats);
    assert.ok(profile.derivedStats);
    assert.ok(Array.isArray(profile.setBonuses.enabled));
    assert.ok(Array.isArray(profile.itemEffects));
    assert.ok(Array.isArray(profile.unsupportedAplRules));
    assert.ok(profile.sourceMap && typeof profile.sourceMap === "object");
  }

  assert.equal(full.character.name, "MID1_Druid_Feral_Wildstalker");
  assert.equal(full.character.level, 90);
  assert.equal(full.character.race, "night_elf");
  assert.equal(full.character.role, "attack");
  assert.equal(full.character.position, "back");
  assert.equal(full.character.profileSource, "default");
  assert.equal(talentOnly.character.level, 90);
  assert.equal(talentOnly.character.race, null);

  assert.equal(full.equipment.status, "resolved-stats-effects-partial");
  assert.equal(full.equipment.complete, false);
  assert.equal(full.equipment.statsComplete, true);
  assert.equal(full.equipment.slots.length, 15);
  assert.equal(full.equipment.bySlot.shoulder.sourceKey, "shoulders");
  assert.equal(full.equipment.bySlot.wrist.sourceKey, "wrists");
  assert.equal(full.equipment.bySlot.trinket1.itemId, 193701);
  assert.equal(full.equipment.bySlot.trinket1.name, "algethar_puzzle_box");
  assert.equal(full.equipment.bySlot.head.itemLevel, 289);
  assert.deepEqual(full.equipment.bySlot.head.gemIds, [240983]);
  assert.equal(talentOnly.equipment.status, "not-provided");
  assert.equal(talentOnly.equipment.slots.length, 0);

  assert.equal(full.baseStats.complete, false);
  assert.equal(full.baseStats.source, "simc-oracle-item-variants+equipment-modifier-catalog");
  assert.deepEqual(full.baseStats.primary, { agility: 1868, stamina: 27307 });
  assert.deepEqual(full.baseStats.equipmentPrimary, { agility: 1246, stamina: 22707 });
  assert.deepEqual(full.baseStats.characterBase, { agility: 622, stamina: 4600 });
  assert.deepEqual(full.baseStats.ratings, {
    criticalStrike: 510,
    haste: 927,
    mastery: 1037,
    versatility: 37,
  });
  assert.equal(full.derivedStats.critChance, full.combatStats.critChance);
  assert.equal(full.derivedStats.ratingConversionComplete, true);
  assert.equal(full.combatStats.critChance, 0.270869565218);
  assert.equal(full.combatStats.hasteMultiplier, 1.210681818182);
  assert.equal(full.combatStats.masteryPoints, 30.54347826087);
  assert.equal(full.combatStats.masteryValue, 0.610869565217);
  assert.equal(full.combatStats.versatilityPercent, 0.006851851852);
  assert.equal(full.combatStats.attackPower, 1868);
  assert.equal(full.combatStats.criticalDamageMultiplier, 1.0404);
  assert.deepEqual(full.baseStats.staticModifierTotals, {
    agility: 123,
    haste_rating: 112,
    mastery_rating: 49,
  });
  assert.deepEqual(
    full.setBonuses.enabled.map((entry) => entry.id),
    [
      "midnight_season_2_2pc",
      "midnight_season_2_4pc",
      "midnight_season_1_2pc",
      "midnight_season_1_4pc",
    ],
  );
  assert.deepEqual(
    full.setBonuses.detectedFromEquipment.map((entry) => entry.id),
    ["midnight_season_1_2pc", "midnight_season_1_4pc"],
  );
  assert.equal(full.setBonuses.conflicts.length, 1);
  assert.equal(full.itemEffects.length, 12);
  assert.equal(full.unsupportedEffects.some((effect) => effect.effectId === "set:midnight_season_1_4pc"), true);
  assert.equal(full.unsupportedEffects.some((effect) => effect.effectId === "set-conflict:1"), true);
  assert.equal(full.actionById.algetharPuzzleBox.itemId, 193701);
  assert.equal(
    full.itemEffects.find((effect) => effect.sourceId === 193701).status,
    "supported",
  );
  assert.equal(
    full.itemEffects.find((effect) => effect.sourceId === 249343).status,
    "partially-supported",
  );
  assert.equal(full.itemEffects.find((effect) => effect.sourceId === 244576).status, "supported");
  assert.equal(full.itemEffects.find((effect) => effect.sourceId === 251513).status, "supported");
  assert.equal(
    full.itemEffects.filter((effect) => effect.sourceId === 7967).every((effect) => effect.status === "supported"),
    true,
  );
  for (const enchantId of [7987, 7993, 8001, 8017]) {
    assert.equal(
      full.unsupportedEffects.some((effect) => effect.effectId === `enchant:${enchantId}:out-of-scope`),
      true,
    );
  }
  assert.equal(full.unsupportedEffects.some((effect) => effect.effectId === "item:193701:special-effect"), false);
  assert.equal(
    full.unsupportedEffects.some(
      (effect) => effect.effectId === "item:249343:alnsight-refresh-icd-bug",
    ),
    true,
  );

  for (const consumed of ["source", "level", "race", "role", "position"]) {
    assert.equal(full.unsupportedFields.some((field) => field.key === consumed), false);
  }
  assert.equal(full.unsupportedFields.some((field) => field.key === "timeofday"), true);
  assert.equal(full.unsupportedFields.some((field) => field.fieldKind === "equipment"), false);
  assert.equal(full.unsupportedFields.some((field) => field.fieldKind === "action-list"), false);
  assert.equal(full.apl.source, "simc-profile");
  assert.equal(full.apl.profileRuleCount, 70);
  assert.equal(full.apl.accountedProfileRuleCount, 70);
  assert.equal(full.apl.rules.length, 15);
  assert.equal(full.apl.filteredRules.length, 1);
  assert.equal(full.unsupportedAplRules.length, 54);
  assert.ok(full.unsupportedAplRules.every(
    (rule) => rule.ruleId && rule.reasonCode && rule.reason && rule.impact && rule.rawLine,
  ));
});

test("ResolvedProfile v2 diff includes character, equipment and set bonus changes", async () => {
  const source = await readFile(
    new URL("../../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url),
    "utf8",
  );
  const full = resolver.resolve(normalizeBuildInput({
    kind: "simc-profile",
    id: "mid1-full-profile-diff",
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
    profileText: source,
  }));
  const talentOnly = resolver.resolve(normalizeBuildInput({
    kind: "talent-code",
    id: "mid1-no-gear-diff",
    talentCode: BUILD_FIXTURES.simcWildstalker.talentCode,
    setBonuses: ["midnight_season_2_2pc"],
  }));
  const diff = resolvedProfileDiff(talentOnly, full);

  assert.ok(diff.characterChanges.some((entry) => entry.path === "character.race"));
  assert.equal(diff.equipmentChanges.length, 15);
  assert.deepEqual(diff.setBonusChanges, [
    {
      id: "midnight_season_1_2pc",
      leftEnabled: false,
      rightEnabled: true,
    },
    {
      id: "midnight_season_1_4pc",
      leftEnabled: false,
      rightEnabled: true,
    },
    {
      id: "midnight_season_2_4pc",
      leftEnabled: false,
      rightEnabled: true,
    },
  ]);
  assert.ok(diff.baseStatChanges.some((entry) => entry.path === "baseStats.source"));
  assert.equal(
    diff.itemEffectChanges.filter((entry) => entry.path.endsWith(".id")).length,
    12,
  );
  assert.equal(
    diff.itemEffectChanges.some((entry) => entry.right === "item:193701:special-effect"),
    true,
  );
  assert.equal(diff.unsupportedFields.left.length, 0);
  assert.ok(diff.unsupportedFields.right.length > 0);
});

test("MID1 equipment derives its 2pc/4pc without explicit set declarations", async () => {
  const source = await readFile(
    new URL("../../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url),
    "utf8",
  );
  const profile = resolver.resolve(normalizeBuildInput({
    kind: "simc-profile",
    id: "mid1-auto-tier",
    profileText: source,
  }));

  assert.deepEqual(
    profile.setBonuses.enabled.map((entry) => entry.id),
    ["midnight_season_1_2pc", "midnight_season_1_4pc"],
  );
  assert.equal(profile.setBonuses.enabled.every((entry) => entry.source === "equipment"), true);
  assert.equal(profile.build.setBonuses.includes("midnight_season_2_2pc"), false);
  assert.equal(profile.setBonuses.conflicts.length, 0);
  assert.equal(profile.unsupportedEffects.some((effect) => effect.effectId === "set:midnight_season_1_2pc"), true);
  assert.equal(profile.unsupportedEffects.some((effect) => effect.effectId === "set:midnight_season_1_4pc"), true);
});

test("unknown equipment variants remain unsupported and cannot masquerade as resolved stats", () => {
  const source = [
    "druid=UnknownVariant",
    "spec=feral",
    `talents=${BUILD_FIXTURES.userValidation.talentCode}`,
    "head=unknown_hood,id=999999,ilevel=999,bonus_id=1/2/3",
  ].join("\n");
  const profile = resolver.resolve(normalizeBuildInput({ kind: "simc-profile", profileText: source }));

  assert.equal(profile.equipment.status, "parsed-pending-data-resolution");
  assert.equal(profile.equipment.statsComplete, false);
  assert.equal(profile.equipment.unresolvedVariantKeys.length, 1);
  assert.equal(profile.baseStats.primary.agility, null);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "head"), true);
});

test("legacy runtime adapter preserves the v1 surface without losing structured gates", () => {
  const v2 = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.userValidation));
  const legacy = createLegacyRuntimeProfile(v2);

  assert.equal(legacy.schemaVersion, 1);
  assert.equal(legacy.id, v2.id);
  assert.deepEqual(legacy.actions, v2.actions);
  assert.deepEqual(legacy.resources, v2.resources);
  assert.deepEqual(legacy.build, v2.build);
  assert.deepEqual(legacy.unsupportedFields, v2.unsupportedFields);
  assert.deepEqual(legacy.unsupportedEffects, v2.unsupportedEffects);
  assert.equal("equipment" in legacy, false);
});

test("invalid character and item numbers remain visible instead of being silently coerced", () => {
  const source = [
    "druid=InvalidNumbers",
    "spec=feral",
    `talents=${BUILD_FIXTURES.userValidation.talentCode}`,
    "level=90oops",
    "head=test_hood,id=123oops,ilevel=710oops",
  ].join("\n");
  const profile = resolver.resolve(normalizeBuildInput({ kind: "simc-profile", profileText: source }));

  assert.equal(profile.character.level, 90);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "level"), true);
  assert.equal(profile.equipment.bySlot.head.itemId, null);
  assert.equal(profile.equipment.bySlot.head.itemLevel, null);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "head"), true);
});

test("known set_bonus declarations are consumed while unknown declarations stay gated", () => {
  const base = [
    "druid=SetBonusProfile",
    "spec=feral",
    `talents=${BUILD_FIXTURES.userValidation.talentCode}`,
  ];
  const known = resolver.resolve(normalizeBuildInput({
    kind: "simc-profile",
    profileText: [...base, "set_bonus=midnight_season_2_2pc=1"].join("\n"),
  }));
  const unknown = resolver.resolve(normalizeBuildInput({
    kind: "simc-profile",
    profileText: [...base, "set_bonus=unmapped_feral_4pc=1"].join("\n"),
  }));

  assert.deepEqual(known.setBonuses.enabled.map((entry) => entry.id), ["midnight_season_2_2pc"]);
  assert.equal(known.unsupportedFields.some((field) => field.key === "set_bonus"), false);
  assert.equal(unknown.setBonuses.enabled.length, 0);
  assert.equal(unknown.setBonuses.profileDeclarations[0].understood, false);
  assert.equal(unknown.unsupportedFields.some((field) => field.key === "set_bonus"), true);
});
