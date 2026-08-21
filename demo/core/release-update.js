import { BROWSER_RELEASE, BROWSER_RESOURCE_HASHES } from "../release.generated.js";

const HASH_FIELDS = ["runtimeHash", "catalogHash", "aplHash", "iconManifestHash"];
const REQUIRED_FIELDS = [
  "releaseId",
  "schemaVersion",
  "gameVersion",
  "gameBuild",
  "simcCommit",
  ...HASH_FIELDS,
  "minimumCompatibleProfileSchema",
  "createdAt",
];

function assertReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("release.json must contain an object");
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] == null || manifest[field] === "") throw new Error(`release.json is missing '${field}'`);
  }
  for (const field of HASH_FIELDS) {
    if (!/^[0-9a-f]{64}$/.test(manifest[field])) throw new Error(`release.json '${field}' is not sha256`);
  }
  if (!Array.isArray(manifest.resources)) throw new Error("release.json resources must be an array");
  for (const resource of manifest.resources) {
    if (typeof resource.path !== "string" || !/^[0-9a-f]{64}$/.test(resource.sha256)) {
      throw new Error("release.json contains an invalid resource record");
    }
  }
  return manifest;
}

export function compareBrowserReleases(remote, {
  current = BROWSER_RELEASE,
  currentResourceHashes = BROWSER_RESOURCE_HASHES,
} = {}) {
  assertReleaseManifest(remote);
  const comparableResources = remote.resources.filter((resource) => resource.group !== "metadata");
  const changedGroups = HASH_FIELDS
    .filter((field) => remote[field] !== current[field])
    .map((field) => field.replace(/Hash$/, ""));
  const remotePaths = new Set(comparableResources.map((resource) => resource.path));
  const changedResources = comparableResources
    .filter((resource) => currentResourceHashes[resource.path] !== resource.sha256)
    .map((resource) => resource.path)
    .sort();
  const removedResources = Object.keys(currentResourceHashes)
    .filter((path) => !remotePaths.has(path))
    .sort();
  const unchangedResources = comparableResources.length - changedResources.length;
  const changed = remote.releaseId !== current.releaseId
    || changedGroups.length > 0
    || changedResources.length > 0
    || removedResources.length > 0;
  return {
    status: changed ? "update-available" : "current",
    currentReleaseId: current.releaseId,
    remoteReleaseId: remote.releaseId,
    changedGroups,
    changedResources,
    removedResources,
    unchangedResources,
    profileSchemaCompatible:
      remote.minimumCompatibleProfileSchema <= current.minimumCompatibleProfileSchema,
    remote,
  };
}

export async function checkForReleaseUpdate({
  fetchImpl = globalThis.fetch,
  url = "./release.json",
  current = BROWSER_RELEASE,
  currentResourceHashes = BROWSER_RESOURCE_HASHES,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Release discovery requires fetch");
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`release.json request failed with HTTP ${response.status}`);
  return compareBrowserReleases(await response.json(), { current, currentResourceHashes });
}

export function versionedResourceUrl(path, manifest) {
  const normalized = path.replace(/^\.\//, "").split("?", 1)[0];
  const resource = manifest.resources.find((entry) => entry.path === normalized);
  return resource ? `${path.split("?", 1)[0]}?h=${resource.sha256}` : path;
}
