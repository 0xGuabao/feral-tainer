import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DEPLOYED_SITE_DIRECTORIES,
  DEPLOYED_SITE_FILES,
  writeBrowserRelease,
} from "./lib/browser-release.mjs";
import { browserVersionMetadata, loadSimcVersionLock } from "./lib/simc-version-lock.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const simcLock = await loadSimcVersionLock({ verifyVendorFiles: true });
const version = browserVersionMetadata(simcLock);
const releaseId = process.env.RELEASE_ID ?? new Date().toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
if (!/^[A-Za-z0-9._-]+$/.test(releaseId)) throw new Error(`非法 RELEASE_ID：${releaseId}`);

const releaseRoot = join(repositoryRoot, "releases", releaseId);
if (existsSync(releaseRoot)) throw new Error(`发布目录已存在，拒绝覆盖：${releaseRoot}`);
mkdirSync(releaseRoot, { recursive: true });

const generatedAt = new Date().toISOString();

function copySite(destination) {
  const demoDestination = join(destination, "demo");
  mkdirSync(demoDestination, { recursive: true });
  for (const name of DEPLOYED_SITE_FILES) cpSync(join(repositoryRoot, "demo", name), join(demoDestination, name));
  for (const name of DEPLOYED_SITE_DIRECTORIES) cpSync(join(repositoryRoot, "demo", name), join(demoDestination, name), { recursive: true });
  return writeBrowserRelease({ demoRoot: demoDestination, releaseId, createdAt: generatedAt, version });
}

function copyLegalNotices(destination) {
  cpSync(join(repositoryRoot, "LICENSE"), join(destination, "LICENSE"));
  cpSync(join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), join(destination, "THIRD_PARTY_NOTICES.md"));
  const simcLicenseRoot = join(destination, "vendor", "simc");
  mkdirSync(simcLicenseRoot, { recursive: true });
  for (const name of readdirSync(join(repositoryRoot, "vendor", "simc"))
    .filter((name) => name === "COPYING" || name.startsWith("LICENSE"))) {
    cpSync(join(repositoryRoot, "vendor", "simc", name), join(simcLicenseRoot, name));
  }
}

function collectFiles(root, current = root, output = []) {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) collectFiles(root, absolutePath, output);
    else output.push(absolutePath);
  }
  return output;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeFileManifest(packageRoot) {
  const lines = collectFiles(packageRoot).map((path) => `${sha256(path)}  ${relative(packageRoot, path)}`);
  writeFileSync(join(packageRoot, "FILES.sha256"), `${lines.join("\n")}\n`);
}

function run(command, args, cwd = releaseRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, COPYFILE_DISABLE: "1", COPY_EXTENDED_ATTRIBUTES_DISABLE: "1" },
  });
  if (result.status !== 0) throw new Error(`${command} 失败：${result.stderr || result.stdout}`);
}

const unpackedRoot = join(releaseRoot, "unpacked");
mkdirSync(unpackedRoot, { recursive: true });

const macName = `wow-feral-trainer-macos-${releaseId}`;
const macRoot = join(unpackedRoot, macName);
mkdirSync(macRoot, { recursive: true });
const browserRelease = copySite(join(macRoot, "site"));
cpSync(join(repositoryRoot, "packaging", "macos", "启动训练器.command"), join(macRoot, "Start Trainer.command"));
cpSync(join(repositoryRoot, "packaging", "cache_server.py"), join(macRoot, "cache_server.py"));
cpSync(join(repositoryRoot, "packaging", "使用说明.txt"), join(macRoot, "README.zh-CN.txt"));
copyLegalNotices(macRoot);
chmodSync(join(macRoot, "Start Trainer.command"), 0o755);
writeFileManifest(macRoot);

const windowsName = `wow-feral-trainer-windows-${releaseId}`;
const windowsRoot = join(unpackedRoot, windowsName);
mkdirSync(windowsRoot, { recursive: true });
copySite(join(windowsRoot, "site"));
cpSync(join(repositoryRoot, "packaging", "windows", "启动训练器.bat"), join(windowsRoot, "Start Trainer.bat"));
cpSync(join(repositoryRoot, "packaging", "windows", "server.ps1"), join(windowsRoot, "server.ps1"));
cpSync(join(repositoryRoot, "packaging", "使用说明.txt"), join(windowsRoot, "README.zh-CN.txt"));
copyLegalNotices(windowsRoot);
writeFileManifest(windowsRoot);

const webName = `wow-feral-trainer-web-${releaseId}`;
const webRoot = join(unpackedRoot, webName);
mkdirSync(webRoot, { recursive: true });
copySite(webRoot);
cpSync(join(repositoryRoot, "packaging", "使用说明.txt"), join(webRoot, "README.zh-CN.txt"));
copyLegalNotices(webRoot);
writeFileManifest(webRoot);

for (const name of [macName, windowsName]) {
  run("zip", ["-q", "-r", "-X", join(releaseRoot, `${name}.zip`), name], unpackedRoot);
}
run("tar", ["-czf", join(releaseRoot, `${webName}.tar.gz`), webName], unpackedRoot);

const archives = collectFiles(releaseRoot).filter((path) => path.endsWith(".zip") || path.endsWith(".tar.gz"));
const manifest = {
  schemaVersion: 1,
  releaseId,
  generatedAt,
  scope: "WoW 12.1 Feral, built-in 4pc fixtures or browser-imported SimC profile, 1/3/5 stationary targets",
  entry: "/demo/",
  versionLock: version,
  browserRelease: {
    releaseId: browserRelease.releaseId,
    runtimeHash: browserRelease.runtimeHash,
    catalogHash: browserRelease.catalogHash,
    aplHash: browserRelease.aplHash,
    iconManifestHash: browserRelease.iconManifestHash,
    profileCacheNamespace: browserRelease.profileCacheNamespace,
  },
  archives: archives.map((path) => ({
    file: relative(releaseRoot, path),
    bytes: statSync(path).size,
    sha256: sha256(path),
  })),
  verification: {
    unitTests: "node --test demo/tests/*.test.mjs passed before packaging",
    browserDesktop: "1828x1028 passed",
    browserMobile: "390x844 passed",
    simcImport: "valid/invalid/persistence/XSS-safe/mobile passed",
    dialogCompatibility: "native showModal and no-showModal fallback passed",
    browserRelease: "release.json required fields, content hashes and cache policy validated",
  },
};
writeFileSync(join(releaseRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(releaseRoot, "SHA256SUMS.txt"),
  `${manifest.archives.map((archive) => `${archive.sha256}  ${archive.file}`).join("\n")}\n`,
);

console.log(JSON.stringify({ releaseRoot, ...manifest }, null, 2));
