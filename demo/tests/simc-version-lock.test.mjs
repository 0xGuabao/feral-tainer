import assert from "node:assert/strict";
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
  totals.new_generic_mechanism = 11;
  totals.custom_mechanism_candidate = 7;
  const review = {
    schemaVersion: 1,
    reviewId: "test-review",
    reviewedAt: "2026-08-21",
    targetCommit: "b458aea6898f3b169310ed243e9934bfa37044bd",
    reviewedCategories: {
      new_generic_mechanism: { expectedLineCount: 11 },
      custom_mechanism_candidate: { expectedLineCount: 7 },
    },
    semanticGroups: [{ id: "reviewed-group" }],
  };
  const reviewed = applyMechanismReview(review, totals, { simcCommit: review.targetCommit });
  assert.equal(reviewed.reviewedLineCount, 18);
  assert.equal(reviewed.unreviewedLineCount, 0);
  assert.throws(
    () => applyMechanismReview(review, { ...totals, custom_mechanism_candidate: 8 }, { simcCommit: review.targetCommit }),
    /Mechanism review drift/,
  );
});
