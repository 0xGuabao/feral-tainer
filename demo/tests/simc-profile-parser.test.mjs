import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBuildInput } from "../core/build-input.js";
import { BuildResolver } from "../core/build-resolver.js";
import {
  getLastProfileValue,
  getProfileAssignments,
  parseSimcProfile,
} from "../core/simc-profile-parser.js";
import { BUILD_FIXTURES } from "../data/12.1/build-fixtures.js";

const fixture = BUILD_FIXTURES.userValidation;

function createProfileText() {
  return [
    "# parser fixture",
    'druid="Lossless Parser"',
    "spec=feral",
    `talents=${fixture.talentCode}`,
    "level=80",
    "head=hood_of_the_test,id=123,ilevel=710,gem_id=456",
    "actions=cat_form",
    "actions+=/rake,if=dot.rake.refreshable",
    "actions.cooldowns+=/use_item,slot=trinket1",
    "set_bonus=THEWARWITHIN2_SEASON3_FERAL,4",
    "this line is deliberately malformed",
    "",
  ].join("\r\n");
}

test("SimC parser preserves lines, repeated assignments, operators and structured unsupported fields", () => {
  const source = createProfileText();
  const profile = parseSimcProfile(source);

  assert.equal(profile.lineEnding, "crlf");
  assert.equal(profile.rawText, source);
  assert.equal(profile.nodes.length, 12);
  assert.equal(profile.assignments.length, 9);
  assert.equal(getLastProfileValue(profile, "druid"), "Lossless Parser");
  assert.deepEqual(
    getProfileAssignments(profile, "actions").map(({ operator, value }) => ({ operator, value })),
    [
      { operator: "=", value: "cat_form" },
      { operator: "+=", value: "/rake,if=dot.rake.refreshable" },
    ],
  );
  assert.deepEqual(profile.sourceMap.actions.map((entry) => entry.lineNumber), [7, 8]);

  const head = getProfileAssignments(profile, "head")[0];
  assert.equal(head.fieldKind, "equipment");
  assert.deepEqual(head.valueSegments.slice(1).map(({ key, value }) => [key, value]), [
    ["id", "123"],
    ["ilevel", "710"],
    ["gem_id", "456"],
  ]);

  assert.equal(profile.unsupportedFields.length, 7);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "spec"), false);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "talents"), false);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "head" && field.fieldKind === "equipment"), true);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "actions" && field.operator === "+="), true);
  assert.equal(profile.unsupportedFields.some((field) => field.fieldKind === "malformed" && field.lineNumber === 11), true);
});

test("normalization and BuildResolver expose parser evidence without changing combat behavior", () => {
  const input = normalizeBuildInput({
    kind: "simc-profile",
    id: "lossless-profile",
    setBonuses: fixture.setBonuses,
    profileText: createProfileText(),
  });
  const profile = new BuildResolver().resolve(input);

  assert.equal(input.simcProfile.schemaVersion, 1);
  assert.equal(input.unsupportedFields.length, 7);
  assert.equal(profile.source.hasFullSimcProfile, true);
  assert.equal(profile.source.simcProfileSchemaVersion, 1);
  assert.equal(profile.source.parsedFieldCount, 9);
  assert.deepEqual(profile.source.sourceMap.actions.map((entry) => entry.operator), ["=", "+="]);
  assert.equal(profile.unsupportedFields.length, 6);
  assert.equal(profile.unsupportedFields.some((field) => field.key === "level"), false);
  assert.deepEqual(
    profile.unsupportedFields.map((field) => field.fieldId),
    input.unsupportedFields.filter((field) => field.key !== "level").map((field) => field.fieldId),
  );
  assert.ok(profile.actionById.moonfire);
  assert.equal(profile.actionById.primalWrath, undefined);
});

test("duplicate applied fields remain lossless while SimC last-assignment semantics select the build", () => {
  const profileText = [
    "druid=DuplicateFixture",
    "spec=guardian",
    "spec=feral",
    `talents=invalid-placeholder`,
    `talents=${fixture.talentCode}`,
  ].join("\n");
  const input = normalizeBuildInput({ kind: "simc-profile", profileText });

  assert.equal(input.talentCode, fixture.talentCode);
  assert.deepEqual(input.simcProfile.valuesByKey.spec, ["guardian", "feral"]);
  assert.equal(input.unsupportedFields.length, 0);
});
