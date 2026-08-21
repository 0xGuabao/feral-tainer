import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const simcLockPath = resolve(projectRoot, "versions/simc.lock.json");

function invariant(condition, message) {
  if (!condition) throw new Error(`Invalid versions/simc.lock.json: ${message}`);
}

function canonicalFingerprint(vendorFiles) {
  const canonical = Object.entries(vendorFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, hash]) => `${path}\0${hash}\n`)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}

function validateLock(lock) {
  invariant(lock?.schemaVersion === 1, "schemaVersion must be 1");
  invariant(/^https:\/\/github\.com\/simulationcraft\/simc\.git$/.test(lock.repository), "repository must be the official SimulationCraft GitHub repository");
  invariant(lock.branch === "midnight", "branch must be midnight");
  invariant(/^[0-9a-f]{40}$/.test(lock.simcCommit), "simcCommit must be a full Git SHA");
  invariant(lock.simcCommitVerification === "partial-source-match", "the mixed snapshot must remain explicitly marked as a partial commit match");
  invariant(/^\d{4}-\d{2}$/.test(lock.simcVersion), "simcVersion must use the SimC release format");
  invariant(/^12\.1\.\d+\.\d+$/.test(lock.wowVersion), "wowVersion must include the full build");
  invariant(Number.isInteger(lock.wowBuild) && lock.wowVersion.endsWith(`.${lock.wowBuild}`), "wowBuild must match wowVersion");
  invariant(Number.isInteger(lock.hotfixBuild), "hotfixBuild must be an integer");
  invariant(/^[0-9a-f]{64}$/.test(lock.hotfixHash), "hotfixHash must be SHA-256");
  invariant(lock.channel === "release", "channel must be release");
  invariant(lock.snapshotKind === "mixed", "the current vendor snapshot must not be represented as a clean checkout");
  invariant(lock.vendorFiles && Object.keys(lock.vendorFiles).length === 7, "exactly seven G1 scan inputs must be locked");
  for (const [path, hash] of Object.entries(lock.vendorFiles)) {
    invariant(!path.startsWith("/") && !path.includes(".."), `unsafe vendor path '${path}'`);
    invariant(/^[0-9a-f]{64}$/.test(hash), `invalid SHA-256 for '${path}'`);
  }
  invariant(canonicalFingerprint(lock.vendorFiles) === lock.vendorFingerprint, "vendorFingerprint does not match vendorFiles");
  invariant(
    lock.commitEvidence?.matchedPaths?.every((path) => lock.vendorFiles[path]),
    "commitEvidence paths must be locked vendor files",
  );
}

export async function loadSimcVersionLock({ verifyVendorFiles = false } = {}) {
  const lock = JSON.parse(await readFile(simcLockPath, "utf8"));
  validateLock(lock);

  if (verifyVendorFiles) {
    for (const [path, expectedHash] of Object.entries(lock.vendorFiles)) {
      const contents = await readFile(resolve(projectRoot, "vendor/simc", path));
      const actualHash = createHash("sha256").update(contents).digest("hex");
      invariant(actualHash === expectedHash, `vendor file drift for '${path}': expected ${expectedHash}, got ${actualHash}`);
    }
  }

  return lock;
}

export function browserVersionMetadata(lock) {
  return {
    schemaVersion: lock.schemaVersion,
    simcCommit: lock.simcCommit,
    simcCommitVerification: lock.simcCommitVerification,
    simcVersion: lock.simcVersion,
    wowVersion: lock.wowVersion,
    wowBuild: lock.wowBuild,
    hotfixDate: lock.hotfixDate,
    hotfixBuild: lock.hotfixBuild,
    hotfixHash: lock.hotfixHash,
    channel: lock.channel,
    snapshotKind: lock.snapshotKind,
    vendorFingerprint: lock.vendorFingerprint,
    profileCacheSchemaVersion: 1,
    profileCacheNamespace: `wow-feral:${lock.wowBuild}:${lock.vendorFingerprint.slice(0, 12)}`,
  };
}

export function assertOracleMatchesLock(lock, oracleVersion) {
  const checks = [
    ["simcVersion", oracleVersion.version, lock.simcVersion],
    ["wowVersion", oracleVersion.gameVersion, lock.wowVersion],
    ["wowBuild", oracleVersion.build, lock.wowBuild],
    ["hotfixBuild", oracleVersion.hotfixBuild, lock.hotfixBuild],
    ["hotfixHash", oracleVersion.hotfixHash, lock.hotfixHash],
  ];
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) throw new Error(`SimC oracle ${label} mismatch: lock=${expected}, oracle=${actual}`);
  }
}
