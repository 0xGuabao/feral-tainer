import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertReleaseId,
  assertSimcScanPassed,
  parseChecksumManifest,
  sha256File,
  verifyChecksumManifest,
  withStagedRelease,
} from "../../scripts/lib/release-gate.mjs";

test("release gate entrypoint resolves every runtime import before parsing options", () => {
  const repositoryRoot = new URL("../../", import.meta.url).pathname;
  const result = spawnSync(process.execPath, ["scripts/run-release-gate.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--release-id is required/);
  assert.doesNotMatch(result.stderr, /SyntaxError/);
});

test("release IDs and checksum manifests reject unsafe input", () => {
  assert.equal(assertReleaseId("20260821-g5-rc1"), "20260821-g5-rc1");
  assert.throws(() => assertReleaseId("../escape"), /非法 RELEASE_ID/);
  assert.throws(() => parseChecksumManifest("not-a-checksum  file\n"), /非法 SHA-256/);

  const root = mkdtempSync(resolve(tmpdir(), "feral-release-checksum-"));
  try {
    writeFileSync(resolve(root, "payload.txt"), "verified\n");
    writeFileSync(resolve(root, "FILES.sha256"), `${sha256File(resolve(root, "payload.txt"))}  payload.txt\n`);
    assert.equal(verifyChecksumManifest(root, resolve(root, "FILES.sha256")).length, 1);
    writeFileSync(resolve(root, "FILES.sha256"), `${"0".repeat(64)}  ../outside.txt\n`);
    assert.throws(() => verifyChecksumManifest(root, resolve(root, "FILES.sha256")), /路径越界/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release gate requires reviewed SimC changes and every zero-valued hard gate", () => {
  const passing = {
    target: { simcCommit: "f".repeat(40), wowVersion: "12.1.0.69404" },
    mechanismReview: { status: "reviewed" },
    summary: {
      unreviewedMechanismCount: 0,
      silentUnsupportedDropCount: 0,
      aplReferencesMissingActionCount: 0,
      unknownChangeLineCount: 0,
    },
  };
  assert.equal(assertSimcScanPassed(passing, {
    commit: "f".repeat(40),
    version: "12.1.0.69404",
  }).unreviewedMechanismCount, 0);
  assert.throws(
    () => assertSimcScanPassed({ ...passing, mechanismReview: { status: "not_supplied" } }),
    /机制审查未完成/,
  );
  assert.throws(
    () => assertSimcScanPassed({ ...passing, summary: { ...passing.summary, silentUnsupportedDropCount: 1 } }),
    /silentUnsupportedDropCount=1/,
  );
});

test("failed staged release leaves no final or partial publish directory", async () => {
  const releasesRoot = mkdtempSync(resolve(tmpdir(), "feral-release-failure-"));
  try {
    await assert.rejects(
      withStagedRelease({
        releasesRoot,
        releaseId: "failure-case",
        buildAndValidate: async ({ candidateRoot }) => {
          mkdirSync(candidateRoot);
          writeFileSync(resolve(candidateRoot, "partial.txt"), "partial\n");
          throw new Error("forced gate failure");
        },
      }),
      /forced gate failure/,
    );
    assert.equal(existsSync(resolve(releasesRoot, "failure-case")), false);
    assert.deepEqual(readdirSync(releasesRoot), [], "失败后不得残留暂存目录");
  } finally {
    rmSync(releasesRoot, { recursive: true, force: true });
  }
});

test("successful staged release becomes visible only after validation returns", async () => {
  const releasesRoot = mkdtempSync(resolve(tmpdir(), "feral-release-success-"));
  try {
    let finalVisibleDuringValidation = true;
    const published = await withStagedRelease({
      releasesRoot,
      releaseId: "success-case",
      buildAndValidate: async ({ candidateRoot }) => {
        mkdirSync(candidateRoot);
        writeFileSync(resolve(candidateRoot, "complete.txt"), "complete\n");
        finalVisibleDuringValidation = existsSync(resolve(releasesRoot, "success-case"));
        return { validated: true };
      },
    });
    assert.equal(finalVisibleDuringValidation, false);
    assert.equal(published.result.validated, true);
    assert.equal(readFileSync(resolve(published.finalRoot, "complete.txt"), "utf8"), "complete\n");
  } finally {
    rmSync(releasesRoot, { recursive: true, force: true });
  }
});
