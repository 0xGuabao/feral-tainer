import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertReleaseId,
  assertSimcScanPassed,
  parseNodeTestCount,
  verifyReleaseArtifacts,
  withStagedRelease,
} from "./lib/release-gate.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releasesRoot = resolve(repositoryRoot, "releases");
const steps = [];

function option(name, fallback = null) {
  const equalsPrefix = `${name}=`;
  const equalsValue = process.argv.slice(2).find((argument) => argument.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function projectPath(value, label) {
  const absolutePath = resolve(repositoryRoot, value);
  const pathRelative = relative(repositoryRoot, absolutePath);
  if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return absolutePath;
}

async function runCommand(command, args, { cwd = repositoryRoot, env = {}, echo = true } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", resolvePromise);
  });
  if (echo && stdout.trim()) process.stdout.write(`${stdout.trimEnd()}\n`);
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${exitCode})\n${stderr || stdout}`);
  }
  return { stdout, stderr };
}

async function gateStep(name, operation) {
  const startedAt = new Date();
  process.stdout.write(`\n[G5] ${name}\n`);
  try {
    const result = await operation();
    steps.push({
      name,
      status: "passed",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    });
    return result;
  } catch (error) {
    steps.push({
      name,
      status: "failed",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error: error.message,
    });
    throw error;
  }
}

function walkFiles(root, predicate, output = []) {
  if (!existsSync(root)) return output;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(path, predicate, output);
    else if (entry.isFile() && predicate(path)) output.push(path);
  }
  return output;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

function startManagedProcess(command, args, { cwd = repositoryRoot, env = {} } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, output: () => ({ stdout, stderr }) };
}

async function stopManagedProcess(processRecord) {
  if (!processRecord || processRecord.child.exitCode !== null || processRecord.child.signalCode !== null) return;
  processRecord.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => processRecord.child.once("close", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ]);
  if (processRecord.child.exitCode === null && processRecord.child.signalCode === null) {
    processRecord.child.kill("SIGKILL");
  }
}

async function waitForUrl(url, timeoutMs, processRecord = null) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    if (processRecord && (processRecord.child.exitCode !== null || processRecord.child.signalCode !== null)) {
      const output = processRecord.output();
      throw new Error(`进程在服务就绪前退出 (${processRecord.child.exitCode})\n${output.stderr || output.stdout}`);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`${url} 在 ${timeoutMs}ms 内未就绪：${lastError?.message ?? "unknown"}`);
}

function chromeExecutable() {
  const explicit = option("--chrome-bin", process.env.CHROME_BIN);
  const candidates = [
    explicit,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("未找到 Chromium/Google Chrome；可通过 --chrome-bin 指定");
  return found;
}

async function verifyBrowserPackage(candidateRoot) {
  const unpackedRoot = resolve(candidateRoot, "unpacked");
  const webName = readdirSync(unpackedRoot).find((name) => name.startsWith("wow-feral-trainer-web-"));
  if (!webName) throw new Error("发行候选缺少 Web 解包目录");
  const webRoot = resolve(unpackedRoot, webName);
  const httpPort = await freePort();
  const cdpPort = await freePort();
  const chromeProfile = mkdtempSync(join(tmpdir(), "wow-feral-g5-chrome-"));
  let serverProcess;
  let chromeProcess;
  try {
    serverProcess = startManagedProcess("python3", [
      resolve(webRoot, "cache_server.py"),
      "--bind", "127.0.0.1",
      "--directory", webRoot,
      "--port", String(httpPort),
    ]);
    const baseUrl = `http://127.0.0.1:${httpPort}/demo/`;
    const indexResponse = await waitForUrl(baseUrl, 10000, serverProcess);
    assert.equal(indexResponse.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
    assert.equal(indexResponse.headers.get("x-content-type-options"), "nosniff");

    const releaseResponse = await fetch(`${baseUrl}release.json`, { cache: "no-store" });
    assert.equal(releaseResponse.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
    const browserRelease = await releaseResponse.json();
    const appResource = browserRelease.resources.find((resource) => resource.path === "app.js");
    assert(appResource, "release.json 缺少 app.js 资源记录");
    const appResponse = await fetch(`${baseUrl}app.js?h=${appResource.sha256}`);
    assert.equal(appResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");

    chromeProcess = startManagedProcess(chromeExecutable(), [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${chromeProfile}`,
      "--window-size=1828,1028",
      baseUrl,
    ]);
    await waitForUrl(`http://127.0.0.1:${cdpPort}/json/list`, 15000, chromeProcess);
    const smoke = await runCommand("node", ["demo/browser-smoke.mjs"], {
      env: { CDP_PORT: String(cdpPort) },
    });
    const result = JSON.parse(smoke.stdout);
    assert.equal(result.ok, true);
    return {
      result,
      cacheHeaders: {
        index: "no-cache, no-store, must-revalidate",
        release: "no-cache, no-store, must-revalidate",
        hashedResource: "public, max-age=31536000, immutable",
      },
    };
  } finally {
    await stopManagedProcess(chromeProcess);
    await stopManagedProcess(serverProcess);
    rmSync(chromeProfile, { recursive: true, force: true });
  }
}

async function rehearsePromotionRollback(candidateRoot, artifacts) {
  const releaseId = artifacts.manifest.releaseId;
  const webArchive = artifacts.archives.find((archive) => archive.file.endsWith(".tar.gz"));
  if (!webArchive) throw new Error("回滚演练缺少 Web 归档");
  const sourceArchive = resolve(candidateRoot, webArchive.file);

  async function prepareScenario(label) {
    const root = mkdtempSync(join(tmpdir(), `wow-feral-g5-${label}-`));
    const releaseBase = resolve(root, "releases/wow-feral-trainer");
    const releaseRoot = resolve(releaseBase, releaseId);
    const siteBase = resolve(root, "sites");
    const oldSite = resolve(root, "old-site");
    mkdirSync(releaseRoot, { recursive: true });
    mkdirSync(siteBase, { recursive: true });
    mkdirSync(oldSite, { recursive: true });
    writeFileSync(resolve(oldSite, "index.html"), "old stable release\n");
    copyFileSync(sourceArchive, resolve(releaseRoot, basename(sourceArchive)));
    symlinkSync(oldSite, resolve(siteBase, "wow-feral-trainer"), "dir");
    return { root, releaseBase, releaseRoot, siteBase, oldSite };
  }

  const success = await prepareScenario("rollback-success");
  let serverProcess;
  try {
    const port = await freePort();
    serverProcess = startManagedProcess("python3", [
      resolve(repositoryRoot, "packaging/cache_server.py"),
      "--directory", resolve(success.siteBase, "wow-feral-trainer"),
      "--port", String(port),
    ]);
    const healthUrl = `http://127.0.0.1:${port}/`;
    await waitForUrl(healthUrl, 10000, serverProcess);
    await runCommand("bash", [
      "scripts/promote-remote-release.sh",
      releaseId,
      webArchive.sha256,
    ], {
      env: {
        FERAL_RELEASE_BASE: success.releaseBase,
        FERAL_SITE_BASE: success.siteBase,
        FERAL_HEALTH_URL: healthUrl,
      },
    });
    const expectedTarget = resolve(
      success.releaseRoot,
      `wow-feral-trainer-web-${releaseId}/demo`,
    );
    assert.equal(
      realpathSync(resolve(success.siteBase, "wow-feral-trainer")),
      realpathSync(expectedTarget),
    );
    assert.equal(
      realpathSync(resolve(success.siteBase, `wow-feral-trainer.previous-${releaseId}`)),
      realpathSync(success.oldSite),
    );
    assert.equal(existsSync(resolve(success.releaseRoot, "deployment.txt")), true);
  } finally {
    await stopManagedProcess(serverProcess);
    rmSync(success.root, { recursive: true, force: true });
  }

  const failure = await prepareScenario("rollback-failure");
  try {
    const unusedPort = await freePort();
    let rejected = null;
    try {
      await runCommand("bash", [
        "scripts/promote-remote-release.sh",
        releaseId,
        webArchive.sha256,
      ], {
        env: {
          FERAL_RELEASE_BASE: failure.releaseBase,
          FERAL_SITE_BASE: failure.siteBase,
          FERAL_HEALTH_URL: `http://127.0.0.1:${unusedPort}/`,
        },
        echo: false,
      });
    } catch (error) {
      rejected = error;
    }
    assert(rejected, "健康检查失败时发布脚本必须返回非零");
    assert.match(rejected.message, /failed \(11\)/);
    assert.equal(
      realpathSync(resolve(failure.siteBase, "wow-feral-trainer")),
      realpathSync(failure.oldSite),
    );
    const expectedFailedTarget = resolve(
      failure.releaseRoot,
      `wow-feral-trainer-web-${releaseId}/demo`,
    );
    assert.equal(
      realpathSync(resolve(failure.siteBase, `wow-feral-trainer.failed-${releaseId}`)),
      realpathSync(expectedFailedTarget),
    );
    assert.equal(existsSync(resolve(failure.siteBase, `wow-feral-trainer.previous-${releaseId}`)), false);
  } finally {
    rmSync(failure.root, { recursive: true, force: true });
  }

  return {
    successfulPromotion: "live switched to candidate and previous retained",
    failedHealthCheck: "candidate retained as failed and original live restored",
    productionServerTouched: false,
  };
}

function scanComparable(report) {
  return {
    target: {
      simcCommit: report.target?.simcCommit,
      wowVersion: report.target?.wowVersion,
      wowBuild: report.target?.wowBuild,
    },
    categories: report.categories,
    summary: report.summary,
    mechanismReview: {
      status: report.mechanismReview?.status,
      reviewId: report.mechanismReview?.reviewId,
      reviewedLineCount: report.mechanismReview?.reviewedLineCount,
      unreviewedLineCount: report.mechanismReview?.unreviewedLineCount,
    },
    files: report.files?.map((file) => ({
      path: file.path,
      changed: file.changed,
      targetSha256: file.target?.sha256,
    })),
  };
}

const releaseId = assertReleaseId(requiredOption("--release-id"));
const targetRoot = resolve(requiredOption("--simc-target-root"));
const targetCommit = requiredOption("--simc-target-commit");
const targetVersion = requiredOption("--simc-target-version");
const reviewFile = projectPath(requiredOption("--simc-review-file"), "--simc-review-file");
const checkedReportFile = projectPath(requiredOption("--simc-report"), "--simc-report");
const scanOutput = resolve(releasesRoot, `.scan-${releaseId}-${process.pid}.json`);
const finalReleaseRoot = resolve(releasesRoot, releaseId);

if (!/^[a-f0-9]{40}$/.test(targetCommit)) throw new Error("--simc-target-commit must be a full Git SHA");
if (!/^12\.1\.\d+\.\d+$/.test(targetVersion)) throw new Error("--simc-target-version must be a full WoW 12.1 version");
if (!statSync(targetRoot).isDirectory()) throw new Error(`SimC target root 不存在：${targetRoot}`);
if (existsSync(finalReleaseRoot)) throw new Error(`发布目录已存在，拒绝覆盖：${finalReleaseRoot}`);
mkdirSync(releasesRoot, { recursive: true });

let sourceCommit;
let scanReport;
let unitTestCount;
let nativeMatrix;

try {
  await gateStep("Git clean baseline", async () => {
    const status = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], { echo: false });
    assert.equal(status.stdout, "", `工作树不干净，拒绝生成发行候选：\n${status.stdout}`);
    sourceCommit = (await runCommand("git", ["rev-parse", "HEAD"], { echo: false })).stdout.trim();
    const originMain = (await runCommand("git", ["rev-parse", "origin/main"], { echo: false })).stdout.trim();
    assert.equal(originMain, sourceCommit, "本地 HEAD 尚未同步到 origin/main");
    const remoteHead = (await runCommand("git", [
      "ls-remote",
      "https://github.com/0xGuabao/feral-tainer.git",
      "refs/heads/main",
    ], { echo: false })).stdout.trim().split(/\s+/, 1)[0];
    assert.equal(remoteHead, sourceCommit, "GitHub main 尚未包含当前发行源码");
  });

  await gateStep("Current SimC upstream scan and semantic review", async () => {
    const targetHead = (await runCommand("git", ["-C", targetRoot, "rev-parse", "HEAD"], { echo: false })).stdout.trim();
    assert.equal(targetHead, targetCommit, "SimC target root HEAD 与 --simc-target-commit 不一致");
    const upstreamHead = (await runCommand("git", [
      "ls-remote",
      "https://github.com/simulationcraft/simc.git",
      "refs/heads/midnight",
    ], { echo: false })).stdout.trim().split(/\s+/, 1)[0];
    assert.equal(upstreamHead, targetCommit, "SimC midnight 已推进，当前 review 不得继续发布");
    await runCommand("node", [
      "scripts/scan-simc-update.mjs",
      "--target-root", targetRoot,
      "--target-commit", targetCommit,
      "--target-version", targetVersion,
      "--target-source", "official sparse checkout from simulationcraft/simc full commit SHA",
      "--review-file", relative(repositoryRoot, reviewFile),
      "--output", relative(repositoryRoot, scanOutput),
    ]);
    scanReport = JSON.parse(readFileSync(scanOutput, "utf8"));
    const checkedReport = JSON.parse(readFileSync(checkedReportFile, "utf8"));
    assertSimcScanPassed(scanReport, { commit: targetCommit, version: targetVersion });
    assert.deepEqual(scanComparable(scanReport), scanComparable(checkedReport), "实时 SimC 扫描与已审查报告不一致");
  });

  await gateStep("Regenerate versioned facts and acceptance evidence", async () => {
    const generators = [
      "scripts/generate-simc-version-module.mjs",
      "scripts/generate-druid-talent-tree.mjs",
      "scripts/generate-feral-tier-set-catalog.mjs",
      "scripts/generate-simc-profile-oracle.mjs",
      "scripts/generate-apl-ir-acceptance.mjs",
      "scripts/generate-architecture-acceptance.mjs",
      "scripts/generate-browser-release.mjs",
    ];
    for (const generator of generators) await runCommand("node", [generator]);
    await runCommand("git", ["diff", "--check"]);
    const status = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], { echo: false });
    assert.equal(status.stdout, "", `生成产物不幂等，拒绝发布：\n${status.stdout}`);
  });

  await gateStep("Unit, architecture and native SimC 1/3/5-target tests", async () => {
    const testFiles = walkFiles(resolve(repositoryRoot, "demo/tests"), (path) => path.endsWith(".test.mjs")).sort();
    const result = await runCommand("node", ["--test", ...testFiles]);
    unitTestCount = parseNodeTestCount(result.stdout);
    assert(unitTestCount && unitTestCount > 0, "未能从测试输出读取测试数量");
    await runCommand("bash", ["validation/run-matrix.sh"]);
    nativeMatrix = [1, 3, 5].map((targetCount) => {
      const report = JSON.parse(readFileSync(resolve(
        repositoryRoot,
        `validation/results/feral-${targetCount}t-4pc.json`,
      ), "utf8"));
      assert.equal(report.sim?.options?.desired_targets, targetCount);
      assert.equal(report.sim?.targets?.length, targetCount);
      return {
        targetCount,
        fightLengthSeconds: report.sim.players?.[0]?.collected_data?.fight_length?.mean,
      };
    });
  });

  await gateStep("JavaScript, shell, Python and diff syntax gates", async () => {
    const jsFiles = [
      ...walkFiles(resolve(repositoryRoot, "demo"), (path) => /\.(?:js|mjs)$/.test(path)),
      ...walkFiles(resolve(repositoryRoot, "scripts"), (path) => /\.(?:js|mjs)$/.test(path)),
      ...walkFiles(resolve(repositoryRoot, "validation/wasm-smoke"), (path) => /\.(?:js|mjs)$/.test(path)),
    ].sort();
    for (const path of jsFiles) await runCommand("node", ["--check", path], { echo: false });
    const shellFiles = [
      ...walkFiles(resolve(repositoryRoot, "scripts"), (path) => path.endsWith(".sh")),
      ...walkFiles(resolve(repositoryRoot, "validation"), (path) => path.endsWith(".sh")),
    ].sort();
    for (const path of shellFiles) await runCommand("bash", ["-n", path], { echo: false });
    await runCommand("python3", [
      "-c",
      "import ast, pathlib; ast.parse(pathlib.Path('packaging/cache_server.py').read_text())",
    ], { echo: false });
    await runCommand("git", ["diff", "--check"], { echo: false });
  });

  const staged = await gateStep("Stage, verify and browser-test all release packages", async () => (
    withStagedRelease({
      releasesRoot,
      releaseId,
      buildAndValidate: async ({ stagingRoot, candidateRoot }) => {
        await runCommand("node", ["scripts/build-offline-release.mjs"], {
          env: { RELEASE_ID: releaseId, RELEASES_ROOT: stagingRoot },
        });
        const artifacts = verifyReleaseArtifacts(candidateRoot);
        const rollback = await rehearsePromotionRollback(candidateRoot, artifacts);
        const browser = await verifyBrowserPackage(candidateRoot);
        const architecture = JSON.parse(readFileSync(resolve(repositoryRoot, "validation/architecture/build-switch-acceptance.json"), "utf8"));
        const profileSummaries = architecture.fixtures.map((fixture) => ({
          id: fixture.id,
          unsupportedFields: fixture.unsupportedFieldSummary.count,
          unsupportedEffects: fixture.unsupportedSummary.count,
          unsupportedAplRules: fixture.unsupportedAplSummary.count,
        }));
        const completedAt = new Date().toISOString();
        artifacts.manifest.verification = {
          status: "passed",
          gate: "scripts/run-release-gate.mjs",
          completedAt,
          sourceCommit,
          simcScan: {
            targetCommit,
            targetVersion,
            reviewId: scanReport.mechanismReview.reviewId,
            reviewedMechanismCount: scanReport.summary.reviewedMechanismCount,
            unreviewedMechanismCount: scanReport.summary.unreviewedMechanismCount,
            silentUnsupportedDropCount: scanReport.summary.silentUnsupportedDropCount,
            targetPromoted: false,
          },
          unitAndArchitectureTests: `${unitTestCount}/${unitTestCount} passed`,
          nativeSimcMatrix: nativeMatrix,
          syntax: "JavaScript/MJS, Shell, Python AST and git diff passed",
          browserDesktop: "1828x1028 passed",
          browserMobile: "390x844 passed",
          simcImport: "valid/invalid/persistence/XSS-safe/mobile passed",
          dialogCompatibility: "native showModal and no-showModal fallback passed",
          cachePolicy: browser.cacheHeaders,
          packageIntegrity: "three archives and all unpacked FILES.sha256 manifests passed",
          openSourceNotices: "project LICENSE, THIRD_PARTY_NOTICES and SimulationCraft license set present in every package",
          rollbackRehearsal: rollback,
        };
        writeFileSync(resolve(candidateRoot, "manifest.json"), `${JSON.stringify(artifacts.manifest, null, 2)}\n`);
        const evidence = {
          schemaVersion: 1,
          releaseId,
          completedAt,
          sourceCommit,
          onlineDeploymentPerformed: false,
          versionLock: artifacts.manifest.versionLock,
          browserRelease: artifacts.manifest.browserRelease,
          simcScan: {
            targetCommit,
            targetVersion,
            targetPromoted: false,
            summary: scanReport.summary,
            categories: scanReport.categories,
          },
          nativeSimcMatrix: nativeMatrix,
          resolvedProfile: {
            differentialBuildDiff: architecture.resolvedProfileDiff,
            profileSummaries,
          },
          archives: artifacts.archives,
          packages: artifacts.packages,
          rollbackRehearsal: rollback,
          browser: browser.result,
          steps: [
            ...steps,
            {
              name: "Stage, verify and browser-test all release packages",
              status: "passed",
              completedAt,
            },
          ],
        };
        writeFileSync(resolve(candidateRoot, "release-gate.json"), `${JSON.stringify(evidence, null, 2)}\n`);
        return { artifacts: evidence, manifest: artifacts.manifest };
      },
    })
  ));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    releaseId,
    releaseRoot: staged.finalRoot,
    sourceCommit,
    simcTarget: { commit: targetCommit, version: targetVersion, promoted: false },
    browserRelease: staged.result.manifest.browserRelease,
    archives: staged.result.artifacts.archives,
  }, null, 2)}\n`);
} finally {
  rmSync(scanOutput, { force: true });
}
