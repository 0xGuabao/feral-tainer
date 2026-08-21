import assert from "node:assert/strict";
import test from "node:test";

import { buildInputFromFixture } from "../core/build-input.js";
import { BuildResolver } from "../core/build-resolver.js";
import {
  IMPORTED_BUILD_KEY,
  LEGACY_PROFILE_STORAGE_KEY,
  LEGACY_SELECTED_BUILD_STORAGE_KEY,
  clearImportedProfile,
  currentProfileCacheKey,
  currentSelectedBuildKey,
  loadAndMigrateImportedProfile,
  loadSelectedBuildKey,
  profileCacheSerializedBytes,
  saveImportedProfile,
} from "../core/profile-cache.js";
import { BUILD_FIXTURES } from "../data/12.1/build-fixtures.js";
import { BROWSER_RELEASE } from "../release.generated.js";

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
    this.failOnSetKey = null;
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.failOnSetKey) throw new Error("simulated quota failure");
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const profileText = BUILD_FIXTURES.simcMid1Equipped.profileText;
const resolvedProfile = new BuildResolver().resolve(buildInputFromFixture(BUILD_FIXTURES.simcMid1Equipped));

function priorRelease(suffix = "prior") {
  return {
    ...BROWSER_RELEASE,
    releaseId: `${BROWSER_RELEASE.releaseId}-${suffix}`,
    catalogHash: "1".repeat(64),
    profileCacheNamespace: `${BROWSER_RELEASE.profileCacheNamespace}:${suffix}`,
  };
}

test("namespaced Profile cache stores raw SimC, hydrated ResolvedProfile, version facts and unsupported lists", () => {
  const storage = new MemoryStorage();
  const record = saveImportedProfile({
    storage,
    profileText,
    resolvedProfile,
    now: "2026-08-21T04:00:00.000Z",
  });

  assert.equal(record.gameBuild, BROWSER_RELEASE.gameBuild);
  assert.equal(record.catalogHash, BROWSER_RELEASE.catalogHash);
  assert.equal(record.profileSchemaVersion, resolvedProfile.schemaVersion);
  assert.deepEqual(record.unsupportedEffects, resolvedProfile.unsupportedEffects);
  assert.deepEqual(record.unsupportedAplRules, resolvedProfile.unsupportedAplRules);
  assert.ok(profileCacheSerializedBytes(record) < 512 * 1024);
  assert.equal(storage.getItem(currentSelectedBuildKey()), IMPORTED_BUILD_KEY);

  const loaded = loadAndMigrateImportedProfile({ storage });
  assert.equal(loaded.status, "current");
  assert.equal(loaded.profileText, profileText);
  assert.equal(typeof loaded.resolvedProfile.actionById, "object");
  assert.equal(loaded.resolvedProfile.unsupportedAplRules.length, resolvedProfile.unsupportedAplRules.length);
});

test("legacy keys migrate into the release namespace while remaining available as rollback", () => {
  const storage = new MemoryStorage([
    [LEGACY_PROFILE_STORAGE_KEY, profileText],
    [LEGACY_SELECTED_BUILD_STORAGE_KEY, IMPORTED_BUILD_KEY],
  ]);
  const result = loadAndMigrateImportedProfile({
    storage,
    now: "2026-08-21T04:01:00.000Z",
  });

  assert.equal(result.status, "migrated");
  assert.equal(result.sourceKey, LEGACY_PROFILE_STORAGE_KEY);
  assert.equal(result.retainedRollback, true);
  assert.equal(result.record.migrationHistory.at(-1).type, "legacy-key-migration");
  assert.equal(storage.getItem(LEGACY_PROFILE_STORAGE_KEY), profileText);
  assert.ok(storage.getItem(currentProfileCacheKey()));
  assert.equal(storage.getItem(currentSelectedBuildKey()), IMPORTED_BUILD_KEY);
});

test("catalog namespace changes reparse raw Profile and expose ResolvedProfile plus unsupported diffs", () => {
  const storage = new MemoryStorage();
  const oldRelease = priorRelease();
  saveImportedProfile({ storage, release: oldRelease, profileText, resolvedProfile });

  const result = loadAndMigrateImportedProfile({
    storage,
    now: "2026-08-21T04:02:00.000Z",
  });

  assert.equal(result.status, "migrated");
  assert.ok(result.diff);
  assert.deepEqual(result.diff.talentChanges, []);
  assert.deepEqual(result.diff.actionChanges, []);
  assert.equal(result.unsupportedDiff.unsupportedEffects.leftCount, resolvedProfile.unsupportedEffects.length);
  assert.equal(result.unsupportedDiff.unsupportedEffects.rightCount, resolvedProfile.unsupportedEffects.length);
  assert.equal(result.unsupportedDiff.unsupportedAplRules.leftCount, resolvedProfile.unsupportedAplRules.length);
  assert.equal(result.unsupportedDiff.unsupportedAplRules.rightCount, resolvedProfile.unsupportedAplRules.length);
  assert.ok(storage.getItem(currentProfileCacheKey(oldRelease)));
  assert.ok(storage.getItem(currentProfileCacheKey()));
});

test("failed reparse preserves the prior namespace and returns a compatible cached profile", () => {
  const storage = new MemoryStorage();
  const oldRelease = priorRelease("failure");
  saveImportedProfile({ storage, release: oldRelease, profileText, resolvedProfile });
  const oldRaw = storage.getItem(currentProfileCacheKey(oldRelease));
  const resolver = { resolve() { throw new Error("simulated resolver failure"); } };

  const result = loadAndMigrateImportedProfile({ storage, resolver });

  assert.equal(result.status, "migration-failed");
  assert.equal(result.resolvedProfile.id, resolvedProfile.id);
  assert.equal(result.retainedRollback, true);
  assert.equal(storage.getItem(currentProfileCacheKey()), null);
  assert.equal(storage.getItem(currentProfileCacheKey(oldRelease)), oldRaw);
  assert.equal(loadSelectedBuildKey({ storage }), IMPORTED_BUILD_KEY);
});

test("transactional cache write restores previous values when selection persistence fails", () => {
  const storage = new MemoryStorage();
  storage.failOnSetKey = currentSelectedBuildKey();

  assert.throws(
    () => saveImportedProfile({ storage, profileText, resolvedProfile }),
    /simulated quota failure/,
  );
  assert.equal(storage.getItem(currentProfileCacheKey()), null);
  assert.equal(storage.getItem(currentSelectedBuildKey()), null);
});

test("clear removes legacy and all namespaced Profile/selection records", () => {
  const storage = new MemoryStorage([
    [LEGACY_PROFILE_STORAGE_KEY, profileText],
    [LEGACY_SELECTED_BUILD_STORAGE_KEY, IMPORTED_BUILD_KEY],
  ]);
  saveImportedProfile({ storage, release: priorRelease("clear"), profileText, resolvedProfile });
  saveImportedProfile({ storage, profileText, resolvedProfile });

  clearImportedProfile({ storage });

  assert.equal(storage.length, 0);
});
