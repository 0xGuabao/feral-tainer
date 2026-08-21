import { BROWSER_RELEASE } from "../release.generated.js";
import { normalizeBuildInput } from "./build-input.js";
import { BuildResolver } from "./build-resolver.js";
import {
  RESOLVED_PROFILE_SCHEMA_VERSION,
  assertResolvedProfile,
  resolvedProfileDiff,
} from "./contracts.js";

export const LEGACY_PROFILE_STORAGE_KEY = "ashamane-lab-simc-profile-v1";
export const LEGACY_SELECTED_BUILD_STORAGE_KEY = "ashamane-lab-selected-build-v1";
export const IMPORTED_BUILD_KEY = "__simc_import__";
export const PROFILE_CACHE_RECORD_SCHEMA_VERSION = 1;

const PROFILE_CACHE_PREFIX = "ashamane-lab-profile-cache-v1:";
const SELECTED_BUILD_PREFIX = "ashamane-lab-selected-build-v2:";
const MAP_TYPE = "ResolvedProfileMap";

function storageOrDefault(storage) {
  return storage ?? globalThis.localStorage;
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value == null ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Profile cache requires a valid timestamp");
  return date.toISOString();
}

function stringifyRecord(record) {
  return JSON.stringify(record, (_key, value) => value instanceof Map
    ? { __profileCacheType: MAP_TYPE, entries: [...value.entries()] }
    : value);
}

function parseRecord(raw) {
  if (!raw) return null;
  const record = JSON.parse(raw, (_key, value) => value?.__profileCacheType === MAP_TYPE
    ? new Map(value.entries)
    : value);
  if (record?.schemaVersion !== PROFILE_CACHE_RECORD_SCHEMA_VERSION) return null;
  if (typeof record.rawProfileText !== "string" || !record.rawProfileText.trim()) return null;
  return record;
}

function readKeys(storage, prefix) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys.sort();
}

function readCandidate(storage, key) {
  try {
    const record = parseRecord(storage.getItem(key));
    return record ? { key, record } : null;
  } catch {
    return null;
  }
}

function newestCandidate(candidates) {
  return candidates
    .filter(Boolean)
    .sort((left, right) => String(right.record.savedAt ?? "").localeCompare(String(left.record.savedAt ?? "")))[0] ?? null;
}

function profileInput(profileText) {
  return normalizeBuildInput({
    kind: "simc-profile",
    id: "simc-imported-feral-profile",
    profileText,
    source: "browser-simc-import",
  });
}

function resolveProfile(profileText, resolver) {
  return resolver.resolve(profileInput(profileText));
}

function compatibleCachedProfile(record, release) {
  const profile = record?.resolvedProfile;
  if (!profile || profile.schemaVersion !== RESOLVED_PROFILE_SCHEMA_VERSION) return null;
  if (profile.schemaVersion < release.minimumCompatibleProfileSchema) return null;
  try {
    return assertResolvedProfile(profile);
  } catch {
    return null;
  }
}

function unsupportedId(entry, kind) {
  if (kind === "fields") return entry.fieldId;
  if (kind === "effects") return entry.effectId;
  return entry.ruleId ?? entry.id ?? `${entry.list ?? "default"}:${entry.lineNumber ?? "?"}:${entry.action ?? "unknown"}`;
}

function unsupportedSetDiff(leftItems = [], rightItems = [], kind) {
  const left = new Set(leftItems.map((entry) => unsupportedId(entry, kind)));
  const right = new Set(rightItems.map((entry) => unsupportedId(entry, kind)));
  return {
    leftCount: left.size,
    rightCount: right.size,
    added: [...right].filter((id) => !left.has(id)).sort(),
    removed: [...left].filter((id) => !right.has(id)).sort(),
  };
}

export function unsupportedProfileDiff(left, right) {
  if (!left || !right) return null;
  return {
    unsupportedFields: unsupportedSetDiff(left.unsupportedFields, right.unsupportedFields, "fields"),
    unsupportedEffects: unsupportedSetDiff(left.unsupportedEffects, right.unsupportedEffects, "effects"),
    unsupportedAplRules: unsupportedSetDiff(left.unsupportedAplRules, right.unsupportedAplRules, "apl"),
  };
}

function createRecord({ profileText, resolvedProfile, previousRecord, release, savedAt, event }) {
  const history = [...(previousRecord?.migrationHistory ?? []), event].slice(-20);
  return {
    schemaVersion: PROFILE_CACHE_RECORD_SCHEMA_VERSION,
    namespace: release.profileCacheNamespace,
    releaseId: release.releaseId,
    rawProfileText: profileText,
    resolvedProfile,
    gameBuild: release.gameBuild,
    catalogHash: release.catalogHash,
    profileSchemaVersion: resolvedProfile.schemaVersion,
    unsupportedFields: resolvedProfile.unsupportedFields,
    unsupportedEffects: resolvedProfile.unsupportedEffects,
    unsupportedAplRules: resolvedProfile.unsupportedAplRules,
    migrationHistory: history,
    savedAt,
  };
}

function restore(storage, key, previous) {
  if (previous == null) storage.removeItem(key);
  else storage.setItem(key, previous);
}

function transactionalWrite(storage, entries) {
  const previous = entries.map(([key]) => [key, storage.getItem(key)]);
  try {
    for (const [key, value] of entries) storage.setItem(key, value);
  } catch (error) {
    try {
      for (const [key, value] of previous) restore(storage, key, value);
    } catch {
      // Preserve the original storage failure as the actionable error.
    }
    throw error;
  }
}

export function currentProfileCacheKey(release = BROWSER_RELEASE) {
  return `${PROFILE_CACHE_PREFIX}${release.profileCacheNamespace}`;
}

export function currentSelectedBuildKey(release = BROWSER_RELEASE) {
  return `${SELECTED_BUILD_PREFIX}${release.profileCacheNamespace}`;
}

function sourceSelection(storage, sourceKey, release) {
  if (sourceKey === LEGACY_PROFILE_STORAGE_KEY) {
    return storage.getItem(LEGACY_SELECTED_BUILD_STORAGE_KEY);
  }
  if (sourceKey?.startsWith(PROFILE_CACHE_PREFIX)) {
    return storage.getItem(`${SELECTED_BUILD_PREFIX}${sourceKey.slice(PROFILE_CACHE_PREFIX.length)}`);
  }
  return storage.getItem(currentSelectedBuildKey(release));
}

function shouldReparse(record, release) {
  return !record?.resolvedProfile
    || record.namespace !== release.profileCacheNamespace
    || record.gameBuild !== release.gameBuild
    || record.catalogHash !== release.catalogHash
    || record.profileSchemaVersion !== RESOLVED_PROFILE_SCHEMA_VERSION;
}

export function loadAndMigrateImportedProfile({
  storage: storageInput,
  release = BROWSER_RELEASE,
  resolver = new BuildResolver(),
  now,
} = {}) {
  const storage = storageOrDefault(storageInput);
  const currentKey = currentProfileCacheKey(release);
  let currentCandidate;
  let source;
  let legacyText;

  try {
    currentCandidate = readCandidate(storage, currentKey);
    const priorCandidates = readKeys(storage, PROFILE_CACHE_PREFIX)
      .filter((key) => key !== currentKey)
      .map((key) => readCandidate(storage, key));
    source = currentCandidate ?? newestCandidate(priorCandidates);
    legacyText = storage.getItem(LEGACY_PROFILE_STORAGE_KEY);
  } catch (error) {
    return { status: "storage-unavailable", profileText: null, resolvedProfile: null, error };
  }

  if (!source && legacyText?.trim()) {
    source = {
      key: LEGACY_PROFILE_STORAGE_KEY,
      record: { rawProfileText: legacyText, migrationHistory: [] },
    };
  }
  if (!source) return { status: "empty", profileText: null, resolvedProfile: null };

  const previousProfile = compatibleCachedProfile(source.record, release);
  if (source.key === currentKey && !shouldReparse(source.record, release) && previousProfile) {
    return {
      status: "current",
      profileText: source.record.rawProfileText,
      resolvedProfile: previousProfile,
      record: source.record,
      sourceKey: source.key,
      diff: null,
      unsupportedDiff: null,
    };
  }

  const migratedAt = timestamp(now);
  try {
    const resolvedProfile = resolveProfile(source.record.rawProfileText, resolver);
    const event = {
      type: source.key === LEGACY_PROFILE_STORAGE_KEY ? "legacy-key-migration" : "release-reparse",
      fromNamespace: source.record.namespace ?? "legacy-v1",
      toNamespace: release.profileCacheNamespace,
      fromReleaseId: source.record.releaseId ?? null,
      toReleaseId: release.releaseId,
      at: migratedAt,
      status: "succeeded",
    };
    const record = createRecord({
      profileText: source.record.rawProfileText,
      resolvedProfile,
      previousRecord: source.record,
      release,
      savedAt: migratedAt,
      event,
    });
    const selected = sourceSelection(storage, source.key, release);
    const writes = [[currentKey, stringifyRecord(record)]];
    if (selected) writes.push([currentSelectedBuildKey(release), selected]);
    transactionalWrite(storage, writes);
    return {
      status: "migrated",
      profileText: record.rawProfileText,
      resolvedProfile,
      record,
      sourceKey: source.key,
      retainedRollback: source.key !== currentKey,
      diff: previousProfile ? resolvedProfileDiff(previousProfile, resolvedProfile) : null,
      unsupportedDiff: unsupportedProfileDiff(previousProfile, resolvedProfile),
    };
  } catch (error) {
    return {
      status: "migration-failed",
      profileText: previousProfile ? source.record.rawProfileText : null,
      resolvedProfile: previousProfile,
      record: source.record,
      sourceKey: source.key,
      retainedRollback: true,
      error,
    };
  }
}

export function saveImportedProfile({
  profileText,
  resolvedProfile: suppliedProfile,
  storage: storageInput,
  release = BROWSER_RELEASE,
  resolver = new BuildResolver(),
  now,
} = {}) {
  const storage = storageOrDefault(storageInput);
  const resolvedProfile = suppliedProfile ?? resolveProfile(profileText, resolver);
  assertResolvedProfile(resolvedProfile);
  const key = currentProfileCacheKey(release);
  const previousRecord = readCandidate(storage, key)?.record ?? null;
  const savedAt = timestamp(now);
  const record = createRecord({
    profileText,
    resolvedProfile,
    previousRecord,
    release,
    savedAt,
    event: {
      type: previousRecord ? "profile-replaced" : "profile-imported",
      fromNamespace: previousRecord?.namespace ?? null,
      toNamespace: release.profileCacheNamespace,
      fromReleaseId: previousRecord?.releaseId ?? null,
      toReleaseId: release.releaseId,
      at: savedAt,
      status: "succeeded",
    },
  });
  transactionalWrite(storage, [
    [key, stringifyRecord(record)],
    [currentSelectedBuildKey(release), IMPORTED_BUILD_KEY],
  ]);
  return record;
}

export function loadSelectedBuildKey({ storage: storageInput, release = BROWSER_RELEASE } = {}) {
  const storage = storageOrDefault(storageInput);
  try {
    const current = storage.getItem(currentSelectedBuildKey(release));
    if (current) return current;
    const prior = newestCandidate(readKeys(storage, PROFILE_CACHE_PREFIX)
      .filter((key) => key !== currentProfileCacheKey(release))
      .map((key) => readCandidate(storage, key)));
    const priorSelection = prior
      ? storage.getItem(`${SELECTED_BUILD_PREFIX}${prior.key.slice(PROFILE_CACHE_PREFIX.length)}`)
      : null;
    return priorSelection ?? storage.getItem(LEGACY_SELECTED_BUILD_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveSelectedBuildKey(selectedBuildKey, {
  storage: storageInput,
  release = BROWSER_RELEASE,
} = {}) {
  storageOrDefault(storageInput).setItem(currentSelectedBuildKey(release), selectedBuildKey);
}

export function clearImportedProfile({ storage: storageInput } = {}) {
  const storage = storageOrDefault(storageInput);
  const keys = [
    ...readKeys(storage, PROFILE_CACHE_PREFIX),
    ...readKeys(storage, SELECTED_BUILD_PREFIX),
    LEGACY_PROFILE_STORAGE_KEY,
    LEGACY_SELECTED_BUILD_STORAGE_KEY,
  ];
  const previous = keys.map((key) => [key, storage.getItem(key)]);
  try {
    for (const key of keys) storage.removeItem(key);
  } catch (error) {
    try {
      for (const [key, value] of previous) restore(storage, key, value);
    } catch {
      // Preserve the original storage failure as the actionable error.
    }
    throw error;
  }
}

export function profileCacheSerializedBytes(record) {
  return new TextEncoder().encode(stringifyRecord(record)).byteLength;
}
