import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

export function assertReleaseId(releaseId) {
  if (!/^[A-Za-z0-9._-]+$/.test(releaseId ?? "")) {
    throw new Error(`非法 RELEASE_ID：${releaseId ?? ""}`);
  }
  return releaseId;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pathInside(root, value) {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(root, value);
  const pathRelative = relative(absoluteRoot, absolutePath);
  if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) {
    throw new Error(`校验清单路径越界：${value}`);
  }
  return absolutePath;
}

export function parseChecksumManifest(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/);
      if (!match) throw new Error(`非法 SHA-256 清单行：${line}`);
      return { sha256: match[1], file: match[2] };
    });
}

export function verifyChecksumManifest(root, manifestPath) {
  const entries = parseChecksumManifest(readFileSync(manifestPath, "utf8"));
  for (const entry of entries) {
    const path = pathInside(root, entry.file);
    if (!statSync(path).isFile()) throw new Error(`校验目标不是文件：${entry.file}`);
    const actual = sha256File(path);
    if (actual !== entry.sha256) {
      throw new Error(`SHA-256 不一致：${entry.file} expected=${entry.sha256} actual=${actual}`);
    }
  }
  return entries;
}

function assertLegalNotices(packageRoot) {
  const required = [
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "vendor/simc/COPYING",
    "vendor/simc/LICENSE",
  ];
  for (const path of required) {
    if (!existsSync(pathInside(packageRoot, path))) throw new Error(`发行包缺少开源声明：${path}`);
  }
  const simcLicenseCount = readdirSync(resolve(packageRoot, "vendor/simc"))
    .filter((name) => name === "COPYING" || name.startsWith("LICENSE"))
    .length;
  if (simcLicenseCount < 2) throw new Error("发行包中的 SimulationCraft 许可证集合不完整");
  return { required, simcLicenseCount };
}

export function assertSimcScanPassed(report, expected = {}) {
  if (expected.commit && report.target?.simcCommit !== expected.commit) {
    throw new Error(`SimC 扫描 commit 不一致：${report.target?.simcCommit}`);
  }
  if (expected.version && report.target?.wowVersion !== expected.version) {
    throw new Error(`SimC 扫描版本不一致：${report.target?.wowVersion}`);
  }
  const summary = report.summary ?? {};
  const zeroGates = [
    "unreviewedMechanismCount",
    "silentUnsupportedDropCount",
    "aplReferencesMissingActionCount",
    "unknownChangeLineCount",
  ];
  for (const field of zeroGates) {
    if (summary[field] !== 0) throw new Error(`SimC 扫描门禁未通过：${field}=${summary[field]}`);
  }
  if (report.mechanismReview?.status !== "reviewed") {
    throw new Error(`SimC 机制审查未完成：${report.mechanismReview?.status ?? "missing"}`);
  }
  return summary;
}

export function verifyReleaseArtifacts(releaseRoot) {
  const manifestPath = resolve(releaseRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.releaseId !== basename(releaseRoot)) {
    throw new Error(`发行 manifest releaseId 不一致：${manifest.releaseId}`);
  }

  const archiveEntries = verifyChecksumManifest(releaseRoot, resolve(releaseRoot, "SHA256SUMS.txt"));
  const declaredArchives = new Map((manifest.archives ?? []).map((archive) => [archive.file, archive]));
  if (archiveEntries.length !== 3 || declaredArchives.size !== 3) {
    throw new Error("发行归档数量必须为 macOS、Windows、Web 三份");
  }
  for (const entry of archiveEntries) {
    const declared = declaredArchives.get(entry.file);
    if (!declared || declared.sha256 !== entry.sha256) {
      throw new Error(`归档清单与 manifest 不一致：${entry.file}`);
    }
  }

  const unpackedRoot = resolve(releaseRoot, "unpacked");
  const packageNames = readdirSync(unpackedRoot)
    .filter((name) => statSync(resolve(unpackedRoot, name)).isDirectory())
    .sort();
  if (packageNames.length !== 3) throw new Error(`解包目录数量错误：${packageNames.length}`);
  const packages = packageNames.map((name) => {
    const packageRoot = resolve(unpackedRoot, name);
    const files = verifyChecksumManifest(packageRoot, resolve(packageRoot, "FILES.sha256"));
    return { name, files: files.length, legal: assertLegalNotices(packageRoot) };
  });

  const requiredBrowserFacts = [
    "releaseId",
    "runtimeHash",
    "catalogHash",
    "aplHash",
    "iconManifestHash",
    "profileCacheNamespace",
  ];
  for (const field of requiredBrowserFacts) {
    if (!manifest.browserRelease?.[field]) throw new Error(`发行 manifest 缺少 browserRelease.${field}`);
  }

  return { manifest, archives: archiveEntries, packages };
}

export async function withStagedRelease({ releasesRoot, releaseId, buildAndValidate }) {
  assertReleaseId(releaseId);
  const finalRoot = resolve(releasesRoot, releaseId);
  if (existsSync(finalRoot)) throw new Error(`发布目录已存在，拒绝覆盖：${finalRoot}`);
  mkdirSync(releasesRoot, { recursive: true });
  const stagingRoot = resolve(releasesRoot, `.staging-${releaseId}-${process.pid}-${Date.now()}`);
  mkdirSync(stagingRoot, { recursive: false });
  try {
    const result = await buildAndValidate({ stagingRoot, candidateRoot: resolve(stagingRoot, releaseId) });
    const candidateRoot = resolve(stagingRoot, releaseId);
    if (!existsSync(candidateRoot)) throw new Error(`暂存发行目录不存在：${candidateRoot}`);
    renameSync(candidateRoot, finalRoot);
    rmSync(stagingRoot, { recursive: true, force: true });
    return { finalRoot, result };
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    if (existsSync(finalRoot)) {
      throw new Error(`门禁失败但最终发行目录意外存在：${finalRoot}`, { cause: error });
    }
    throw error;
  }
}
