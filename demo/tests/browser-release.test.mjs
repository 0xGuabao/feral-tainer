import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { compareBrowserReleases, checkForReleaseUpdate } from "../core/release-update.js";
import { BROWSER_RELEASE, BROWSER_RESOURCE_HASHES } from "../release.generated.js";
import { writeBrowserRelease } from "../../scripts/lib/browser-release.mjs";
import { browserVersionMetadata, loadSimcVersionLock } from "../../scripts/lib/simc-version-lock.mjs";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const demoRoot = join(repositoryRoot, "demo");
const release = JSON.parse(readFileSync(join(demoRoot, "release.json"), "utf8"));

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function combinedHash(resources) {
  const canonical = resources
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((resource) => `${resource.path}\0${resource.sha256}\n`)
    .join("");
  return sha256(canonical);
}

function importMapFromIndex(source) {
  const match = source.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "index.html must contain an import map");
  return JSON.parse(match[1]);
}

test("release.json hashes every deployed resource and exposes the required version facts", () => {
  for (const field of [
    "releaseId", "schemaVersion", "gameVersion", "gameBuild", "simcCommit",
    "runtimeHash", "catalogHash", "aplHash", "iconManifestHash",
    "minimumCompatibleProfileSchema", "createdAt",
  ]) assert.notEqual(release[field], undefined, `missing ${field}`);

  for (const resource of release.resources) {
    assert.equal(sha256(readFileSync(join(demoRoot, resource.path))), resource.sha256, resource.path);
  }
  assert.equal(combinedHash(release.resources.filter((entry) => entry.group === "runtime")), release.runtimeHash);
  assert.equal(combinedHash(release.resources.filter((entry) => entry.group === "catalog")), release.catalogHash);
  assert.equal(combinedHash(release.resources.filter((entry) => entry.group === "apl")), release.aplHash);
  assert.equal(combinedHash(release.resources.filter((entry) => entry.group === "icon")), release.iconManifestHash);
  assert.match(
    release.profileCacheNamespace,
    new RegExp(`:p${release.minimumCompatibleProfileSchema}:${release.catalogHash.slice(0, 12)}$`),
  );
  assert.equal(release.cachePolicy.serviceWorker, false);
});

test("index maps every JavaScript module and static entry to immutable hash URLs", () => {
  const index = readFileSync(join(demoRoot, "index.html"), "utf8");
  const importMap = importMapFromIndex(index);
  const byPath = Object.fromEntries(release.resources.map((resource) => [resource.path, resource]));

  for (const resource of release.resources.filter((entry) => entry.path.endsWith(".js"))) {
    assert.equal(
      importMap.imports[`./${resource.path}`],
      `./${resource.path}?h=${resource.sha256}`,
      resource.path,
    );
  }
  for (const path of ["wow-hud.css", "reference-layout.css", "app.js"]) {
    assert.match(index, new RegExp(`${path.replace(".", "\\.")}\\?h=${byPath[path].sha256}`));
  }
  assert.doesNotMatch(index, /\?v=/);
  assert.equal(BROWSER_RELEASE.runtimeHash, release.runtimeHash);
  assert.deepEqual(BROWSER_RESOURCE_HASHES, Object.fromEntries(
    release.resources
      .filter((resource) => resource.path !== "release.generated.js")
      .map((resource) => [resource.path, resource.sha256]),
  ));
});

test("one changed resource only changes its resource URL and owning group hash", async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "feral-browser-release-"));
  const temporaryDemo = join(temporaryRoot, "demo");
  cpSync(demoRoot, temporaryDemo, { recursive: true });
  const version = browserVersionMetadata(await loadSimcVersionLock({ verifyVendorFiles: false }));
  const options = {
    demoRoot: temporaryDemo,
    releaseId: "browser-release-test",
    createdAt: "2026-08-21T04:03:00.000Z",
    version,
  };
  const before = writeBrowserRelease(options);
  appendFileSync(join(temporaryDemo, "wow-hud.css"), "\n/* release hash isolation test */\n");
  const after = writeBrowserRelease(options);
  const beforeByPath = Object.fromEntries(before.resources.map((entry) => [entry.path, entry.sha256]));
  const afterByPath = Object.fromEntries(after.resources.map((entry) => [entry.path, entry.sha256]));

  assert.notEqual(afterByPath["wow-hud.css"], beforeByPath["wow-hud.css"]);
  assert.notEqual(after.runtimeHash, before.runtimeHash);
  assert.equal(after.catalogHash, before.catalogHash);
  assert.equal(after.aplHash, before.aplHash);
  assert.equal(after.iconManifestHash, before.iconManifestHash);
  for (const path of Object.keys(beforeByPath).filter((path) => !["wow-hud.css", "release.generated.js"].includes(path))) {
    assert.equal(afterByPath[path], beforeByPath[path], path);
  }
});

test("release discovery uses no-store and reports only changed remote resources", async () => {
  const remote = structuredClone(release);
  remote.releaseId = "next-release";
  remote.runtimeHash = "a".repeat(64);
  const changed = remote.resources.find((resource) => resource.path === "app.js");
  changed.sha256 = "b".repeat(64);
  let request;
  const result = await checkForReleaseUpdate({
    fetchImpl: async (...args) => {
      request = args;
      return { ok: true, json: async () => remote };
    },
  });

  assert.equal(request[1].cache, "no-store");
  assert.equal(request[1].headers["Cache-Control"], "no-cache");
  assert.equal(result.status, "update-available");
  assert.deepEqual(result.changedGroups, ["runtime"]);
  assert.deepEqual(result.changedResources, ["app.js"]);
  assert.equal(result.unchangedResources, remote.resources.filter((entry) => entry.group !== "metadata").length - 1);
  assert.equal(compareBrowserReleases(release).status, "current");
});
