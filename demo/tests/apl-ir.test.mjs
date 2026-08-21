import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  APL_IR_OPERATORS,
  APL_IR_TARGET_KINDS,
  APL_IR_VALUE_KINDS,
  validateAplIrRule,
} from "../apl/apl-ir.js";
import { buildInputFromFixture, normalizeBuildInput } from "../core/build-input.js";
import { BuildResolver } from "../core/build-resolver.js";
import { BUILD_FIXTURES } from "../data/12.1/build-fixtures.js";
import { FERAL_APL_IR } from "../data/12.1/feral-apl-ir.js";
import { buildAplIrAcceptance } from "../../scripts/lib/apl-ir-acceptance.mjs";

const resolver = new BuildResolver();
const fullProfileUrl = new URL("../../vendor/simc/profiles/MID1/MID1_Druid_Feral.simc", import.meta.url);

function fullProfileInput(profileText, id = "g3-apl-ir-test") {
  return normalizeBuildInput({
    kind: "simc-profile",
    id,
    profileText,
    setBonuses: BUILD_FIXTURES.simcWildstalker.setBonuses,
    source: "vendor/simc/profiles/MID1/MID1_Druid_Feral.simc",
  });
}

test("Feral APL catalog contains only valid controlled IR operators, values and target selectors", () => {
  assert.equal(FERAL_APL_IR.length, 16);
  assert.deepEqual(APL_IR_OPERATORS, [
    "and", "or", "not", "eq", "ne", "lt", "lte", "gt", "gte",
    "add", "multiply", "min", "if", "in",
  ]);
  assert.deepEqual(APL_IR_VALUE_KINDS, [
    "target_count", "combo_points", "fight_remaining_ms", "last_gcd_action_id",
    "aura_up", "aura_remaining", "cooldown_remaining", "dot_remaining",
    "dot_refreshable", "dot_up", "refreshable_dot_count", "non_refreshable_dot_count",
    "talent_selected", "action_available", "action_channel_duration", "action_channel_field",
  ]);
  assert.deepEqual(APL_IR_TARGET_KINDS, ["none", "active", "index", "dot"]);
  for (const rule of FERAL_APL_IR) {
    assert.deepEqual(validateAplIrRule(rule), [], `${rule.id} must validate`);
    assert.ok(rule.source.sourceRef);
    assert.ok(rule.source.list);
    assert.ok(rule.source.simcAction);
  }
});

test("generic APL runtime, UI and InteractiveController contain no build-specific mechanism branches", async () => {
  const sources = await Promise.all([
    "../apl/apl-ir.js",
    "../apl/apl-compiler.js",
    "../apl/feral-apl-adapter.js",
    "../core/interactive-controller.js",
    "../app.js",
  ].map(async (relativePath) => ({
    relativePath,
    source: await readFile(new URL(relativePath, import.meta.url), "utf8"),
  })));
  const forbidden = /\b(?:lunar_inspiration|primal_wrath|primalWrath|moonfire|tigersFury|ferociousBite)\b/;
  for (const { relativePath, source } of sources) {
    assert.doesNotMatch(source, forbidden, `${relativePath} must stay build-agnostic`);
    assert.doesNotMatch(source, /\bCONDITIONS\b/, `${relativePath} cannot restore named condition dispatch`);
  }
});

test("two differential talent builds filter every unavailable APL action without engine duplication", () => {
  const user = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.userValidation));
  const primal = resolver.resolve(buildInputFromFixture(BUILD_FIXTURES.primalWrath));

  assert.ok(user.actionById.moonfire);
  assert.equal(user.actionById.primalWrath, undefined);
  assert.ok(primal.actionById.primalWrath);
  assert.equal(primal.actionById.moonfire, undefined);
  assert.deepEqual(user.apl.filteredRules.map((rule) => rule.actionId), ["primalWrath"]);
  assert.deepEqual(primal.apl.filteredRules.map((rule) => rule.actionId), ["moonfire", "moonfire"]);

  for (const profile of [user, primal]) {
    assert.equal(profile.apl.source, "authored-default");
    assert.equal(profile.unsupportedAplRules.length, 0);
    assert.ok(profile.apl.rules.every((rule) => profile.actionById[rule.actionId]));
  }
});

test("full SimC Profile APL is fully accounted as compiled, filtered or structured unsupported", async () => {
  const source = await readFile(fullProfileUrl, "utf8");
  const profile = resolver.resolve(fullProfileInput(source));

  assert.equal(profile.apl.source, "simc-profile");
  assert.equal(profile.apl.profileRuleCount, 70);
  assert.equal(profile.apl.rules.length, 15);
  assert.equal(profile.apl.filteredRules.length, 1);
  assert.equal(profile.unsupportedAplRules.length, 54);
  assert.equal(profile.apl.accountedProfileRuleCount, 70);
  assert.equal(profile.unsupportedFields.some((field) => field.fieldKind === "action-list"), false);
  assert.ok(profile.unsupportedAplRules.every(
    (rule) => rule.ruleId && rule.reasonCode && rule.reason && rule.impact && rule.rawLine,
  ));
  assert.deepEqual(
    Object.fromEntries(["action_or_command_not_supported", "control_flow_not_whitelisted", "condition_not_whitelisted"]
      .map((reasonCode) => [
        reasonCode,
        profile.unsupportedAplRules.filter((rule) => rule.reasonCode === reasonCode).length,
      ])),
    {
      action_or_command_not_supported: 27,
      control_flow_not_whitelisted: 21,
      condition_not_whitelisted: 6,
    },
  );
});

test("Profile APL source drift becomes structured unsupported instead of silently using authored behavior", async () => {
  const source = await readFile(fullProfileUrl, "utf8");
  const drifted = source.replace(
    /^(actions\+=\/tigers_fury,if=.*)$/m,
    "$1&energy>0",
  );
  assert.notEqual(drifted, source, "fixture must mutate the bound Profile rule");

  const profile = resolver.resolve(fullProfileInput(drifted, "g3-apl-source-drift"));
  assert.equal(profile.apl.profileRuleCount, 70);
  assert.equal(profile.apl.rules.length, 14);
  assert.equal(profile.apl.filteredRules.length, 1);
  assert.equal(profile.unsupportedAplRules.length, 55);
  assert.equal(profile.apl.accountedProfileRuleCount, 70);
  assert.ok(profile.unsupportedAplRules.some((rule) =>
    rule.action === "tigers_fury" && rule.reasonCode === "condition_not_whitelisted"));
});

test("checked-in G3 acceptance stays reproducible across both builds and 1/3/5 targets", async () => {
  const checkedIn = JSON.parse(await readFile(
    new URL("../../validation/apl/g3-apl-ir-acceptance.json", import.meta.url),
    "utf8",
  ));
  const current = await buildAplIrAcceptance();
  assert.deepEqual(checkedIn, current);
  assert.deepEqual(current.gates, {
    twoDifferentialBuilds: true,
    sameControllerForAllTraces: true,
    targetCountsCovered: [1, 3, 5],
    unavailableRecommendationCount: 0,
    fullProfileAplAccountingDelta: 0,
    actionListFieldsLeftInUnsupportedFields: 0,
  });

  const trace = (fixtureKey, targetCount) => current.traces.find(
    (entry) => entry.fixtureKey === fixtureKey && entry.targetCount === targetCount,
  );
  for (const fixtureKey of ["userValidation", "primalWrath"]) {
    for (const targetCount of [1, 3, 5]) {
      assert.ok(trace(fixtureKey, targetCount));
      assert.equal(trace(fixtureKey, targetCount).decisions.length, 20);
      assert.deepEqual(trace(fixtureKey, targetCount).unavailableRecommendations, []);
    }
  }
  assert.ok(trace("userValidation", 1).recommendedSkillIds.includes("moonfire"));
  assert.equal(trace("userValidation", 5).recommendedSkillIds.includes("primalWrath"), false);
  assert.ok(trace("primalWrath", 3).recommendedSkillIds.includes("primalWrath"));
  assert.equal(trace("primalWrath", 5).recommendedSkillIds.includes("moonfire"), false);
});
