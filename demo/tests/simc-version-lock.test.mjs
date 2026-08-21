import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SIMC_VERSION_LOCK } from "../data/12.1/version.generated.js";
import {
  browserVersionMetadata,
  loadSimcVersionLock,
} from "../../scripts/lib/simc-version-lock.mjs";
import {
  CHANGE_CATEGORIES,
  SCAN_PATHS,
  applyMechanismReview,
  classifyChange,
} from "../../scripts/lib/simc-update-scan.mjs";

test("SimC version lock validates all seven vendor inputs and matches browser metadata", async () => {
  const lock = await loadSimcVersionLock({ verifyVendorFiles: true });
  assert.equal(Object.keys(lock.vendorFiles).length, 7);
  assert.equal(lock.snapshotKind, "mixed");
  assert.equal(lock.simcCommitVerification, "partial-source-match");
  assert.deepEqual(SIMC_VERSION_LOCK, browserVersionMetadata(lock));
});

test("SimC update scanner covers every G1 file and required change category", () => {
  assert.equal(SCAN_PATHS.length, 7);
  assert.deepEqual(CHANGE_CATEGORIES, [
    "version_only",
    "talent",
    "action_number_or_resource",
    "timing_or_cooldown",
    "aura_or_dot",
    "apl",
    "tier_set",
    "gear_or_trinket",
    "new_generic_mechanism",
    "custom_mechanism_candidate",
    "unknown",
  ]);
  assert.equal(classifyChange("engine/class_modules/apl/druid/feral_apl.inc", "actions+=/rake"), "apl");
  assert.equal(classifyChange("engine/dbc/generated/trait_data.inc", "Twin Sprouts"), "talent");
  assert.equal(classifyChange("engine/player/unique_gear_midnight.cpp", "register_callback( foo )", "added"), "custom_mechanism_candidate");
  assert.equal(classifyChange("engine/player/unique_gear_midnight.cpp", "struct venomcursed_cb_t : public dbc_proc_callback_t", "added"), "custom_mechanism_candidate");
  assert.equal(classifyChange("engine/player/unique_gear_midnight.cpp", "void execute( const spell_data_t* ) override", "added"), "custom_mechanism_candidate");
  assert.equal(classifyChange("engine/player/unique_gear_midnight.cpp", "rppm = 2.0", "added"), "new_generic_mechanism");

  const totals = Object.fromEntries(CHANGE_CATEGORIES.map((category) => [category, 0]));
  totals.new_generic_mechanism = 10;
  totals.custom_mechanism_candidate = 7;
  const review = {
    schemaVersion: 1,
    reviewId: "test-review",
    reviewedAt: "2026-08-21",
    targetCommit: "70c46902f3a1218a5d03c46607d07ec443ffe356",
    reviewedCategories: {
      new_generic_mechanism: { expectedLineCount: 10 },
      custom_mechanism_candidate: { expectedLineCount: 7 },
    },
    semanticGroups: [{ id: "reviewed-group" }],
  };
  const reviewed = applyMechanismReview(review, totals, { simcCommit: review.targetCommit });
  assert.equal(reviewed.reviewedLineCount, 17);
  assert.equal(reviewed.unreviewedLineCount, 0);
  assert.throws(
    () => applyMechanismReview(review, { ...totals, custom_mechanism_candidate: 8 }, { simcCommit: review.targetCommit }),
    /Mechanism review drift/,
  );
  assert.throws(
    () => applyMechanismReview(review, totals, { simcCommit: "fefb8816af0aaa97819c9a8ba61cca058a81822e" }),
    /targetCommit mismatch/,
  );
});

test("checked-in G1 report is bound to its semantic review and passes every hard gate", async () => {
  const [review, report] = await Promise.all([
    readFile(new URL("../../versions/simc-update-reviews/12.1.0.69404.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../validation/updates/12.1.0.69404/simc-update-report.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.equal(report.target.simcCommit, review.targetCommit);
  assert.equal(report.mechanismReview.reviewId, review.reviewId);
  assert.equal(report.mechanismReview.status, "reviewed");
  assert.equal(report.summary.reviewedMechanismCount, 17);
  assert.equal(report.summary.unreviewedMechanismCount, 0);
  assert.equal(report.summary.silentUnsupportedDropCount, 0);
  assert.equal(report.summary.aplReferencesMissingActionCount, 0);
  assert.equal(report.summary.unknownChangeLineCount, 0);
  assert.equal(report.summary.releaseGate, "g1_scan_passed_target_not_promoted");
});

test("latest G5 upstream report is commit-bound and byte-equivalent to the prior reviewed scan inputs", async () => {
  const [priorReport, review, report] = await Promise.all([
    readFile(new URL("../../validation/updates/12.1.0.69404-fefb8816/simc-update-report.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../versions/simc-update-reviews/12.1.0.69404-69a46e15.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../validation/updates/12.1.0.69404-69a46e15/simc-update-report.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.equal(report.target.simcCommit, "69a46e15b4b0b364e837998ce329801c5525a968");
  assert.equal(report.target.simcCommit, review.targetCommit);
  assert.equal(report.mechanismReview.reviewId, review.reviewId);
  assert.equal(report.summary.unreviewedMechanismCount, 0);
  assert.equal(report.summary.silentUnsupportedDropCount, 0);
  assert.equal(report.summary.aplReferencesMissingActionCount, 0);
  assert.equal(report.summary.unknownChangeLineCount, 0);
  assert.equal(report.summary.releaseGate, "g1_scan_passed_target_not_promoted");

  const priorHashes = Object.fromEntries(priorReport.files.map((file) => [file.path, file.target.sha256]));
  const currentHashes = Object.fromEntries(report.files.map((file) => [file.path, file.target.sha256]));
  assert.deepEqual(currentHashes, priorHashes);
  assert.deepEqual(currentHashes, review.equivalenceEvidence.scanInputSha256);
});
