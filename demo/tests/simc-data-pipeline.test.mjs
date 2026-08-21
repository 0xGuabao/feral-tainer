import assert from "node:assert/strict";
import test from "node:test";

import {
  FERAL_TIER_SET_CATALOG,
} from "../data/12.1/feral-tier-sets.generated.js";
import {
  SIMC_ITEM_VARIANT_CATALOG,
  SIMC_ORACLE_METADATA,
} from "../data/12.1/simc-oracle-catalog.generated.js";
import { SIMC_VERSION_LOCK } from "../data/12.1/version.generated.js";

test("generated 12.1 Feral tier catalog preserves MID1 and MID2 2pc/4pc identities", () => {
  assert.deepEqual(
    FERAL_TIER_SET_CATALOG.map((entry) => ({
      id: entry.id,
      spellId: entry.spellId,
      itemCount: entry.itemIds.length,
    })),
    [
      { id: "midnight_season_1_2pc", spellId: 1264812, itemCount: 5 },
      { id: "midnight_season_1_4pc", spellId: 1264813, itemCount: 5 },
      { id: "midnight_season_2_2pc", spellId: 1296605, itemCount: 5 },
      { id: "midnight_season_2_4pc", spellId: 1296606, itemCount: 5 },
    ],
  );
  assert.equal(
    FERAL_TIER_SET_CATALOG.every((entry) => entry.source.kind === "simc-generated-dbc"),
    true,
  );
});

test("generated SimC item oracle is versioned and contains the complete MID1 fixture equipment", () => {
  assert.equal(SIMC_ORACLE_METADATA.schemaVersion, 1);
  assert.equal(SIMC_ORACLE_METADATA.gameVersion, SIMC_VERSION_LOCK.wowVersion);
  assert.equal(SIMC_ORACLE_METADATA.simcVersion, SIMC_VERSION_LOCK.simcVersion);
  assert.deepEqual(SIMC_ORACLE_METADATA.versionLock, SIMC_VERSION_LOCK);
  assert.equal(SIMC_ORACLE_METADATA.profiles.length, 1);
  assert.equal(Object.keys(SIMC_ITEM_VARIANT_CATALOG).length, 15);
  assert.equal(
    Object.values(SIMC_ITEM_VARIANT_CATALOG).every((entry) => (
      entry.sourceProfileSha256 === SIMC_ORACLE_METADATA.profiles[0].sha256
    )),
    true,
  );
});
