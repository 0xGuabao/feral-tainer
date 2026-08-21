import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { loadSimcVersionLock, projectRoot } from "./lib/simc-version-lock.mjs";
import { scanSimcRoots } from "./lib/simc-update-scan.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function projectOutput(value) {
  const absolute = resolve(projectRoot, value);
  const projectRelative = relative(projectRoot, absolute);
  if (projectRelative === ".." || projectRelative.startsWith(`..${sep}`)) {
    throw new Error("--output must stay inside the project root");
  }
  return absolute;
}

const lock = await loadSimcVersionLock({ verifyVendorFiles: true });
const targetRoot = resolve(requiredOption("--target-root"));
const targetCommit = requiredOption("--target-commit");
if (!/^[0-9a-f]{40}$/.test(targetCommit)) throw new Error("--target-commit must be a full Git SHA");
const targetVersion = requiredOption("--target-version");
const targetBuild = Number(targetVersion.split(".").at(-1));
if (!/^12\.1\.\d+\.\d+$/.test(targetVersion) || !Number.isInteger(targetBuild)) {
  throw new Error("--target-version must include the full 12.1 build");
}
const outputPath = projectOutput(option(
  "--output",
  `validation/updates/${targetVersion}/simc-update-report.json`,
));
const reviewOption = option("--review-file");
const reviewPath = reviewOption ? projectOutput(reviewOption) : null;
const mechanismReview = reviewPath ? JSON.parse(await readFile(reviewPath, "utf8")) : null;

const report = await scanSimcRoots({
  baseRoot: resolve(projectRoot, "vendor/simc"),
  targetRoot,
  baseMetadata: {
    source: "versions/simc.lock.json",
    simcCommit: lock.simcCommit,
    simcCommitVerification: lock.simcCommitVerification,
    simcVersion: lock.simcVersion,
    wowVersion: lock.wowVersion,
    wowBuild: lock.wowBuild,
    hotfixBuild: lock.hotfixBuild,
    hotfixHash: lock.hotfixHash,
    snapshotKind: lock.snapshotKind,
    vendorFingerprint: lock.vendorFingerprint,
  },
  targetMetadata: {
    repository: lock.repository,
    branch: lock.branch,
    simcCommit: targetCommit,
    wowVersion: targetVersion,
    wowBuild: targetBuild,
    sourceAcquisition: option("--target-source", "explicit upstream checkout or verified download root"),
  },
  mechanismReview,
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: report.summary, categories: report.categories }, null, 2));
