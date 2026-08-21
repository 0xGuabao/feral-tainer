import { existsSync, readFileSync } from "node:fs";

import { writeBrowserRelease } from "./lib/browser-release.mjs";
import { browserVersionMetadata, loadSimcVersionLock, projectRoot } from "./lib/simc-version-lock.mjs";

function optionValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return argument?.slice(prefix.length) ?? null;
}

const demoRoot = new URL("../demo/", import.meta.url).pathname;
const existingPath = new URL("../demo/release.json", import.meta.url).pathname;
const existing = existsSync(existingPath) ? JSON.parse(readFileSync(existingPath, "utf8")) : null;
const lock = await loadSimcVersionLock({ verifyVendorFiles: true });
const version = browserVersionMetadata(lock);
const releaseId = optionValue("--release-id") ?? existing?.releaseId ?? `wow-${version.wowBuild}-${version.vendorFingerprint.slice(0, 12)}`;
const createdAt = optionValue("--created-at") ?? existing?.createdAt ?? new Date().toISOString();
const release = writeBrowserRelease({ demoRoot, releaseId, createdAt, version });

console.log(JSON.stringify({
  projectRoot,
  output: "demo/release.json",
  releaseId: release.releaseId,
  resources: release.resources.length,
  runtimeHash: release.runtimeHash,
  catalogHash: release.catalogHash,
  aplHash: release.aplHash,
  iconManifestHash: release.iconManifestHash,
}, null, 2));
