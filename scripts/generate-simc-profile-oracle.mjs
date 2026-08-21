import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { normalizeBuildInput } from "../demo/core/build-input.js";
import { parseEquipment } from "../demo/core/equipment-parser.js";
import { canonicalSimcEquipmentSlot } from "../demo/core/simc-profile-parser.js";
import {
  assertOracleMatchesLock,
  browserVersionMetadata,
  loadSimcVersionLock,
} from "./lib/simc-version-lock.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const simcPath = process.env.SIMC_BIN
  ? resolve(process.env.SIMC_BIN)
  : join(projectRoot, "vendor/simc/engine/simc");
const defaultManifestPath = join(projectRoot, "validation/oracles/simc-profile-manifest.json");
const defaultGeneratedModulePath = join(projectRoot, "demo/data/12.1/generated/simc-oracle-catalog.generated.js");
const simcLock = await loadSimcVersionLock({ verifyVendorFiles: true });

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function projectPath(value, label) {
  const absolutePath = resolve(projectRoot, value);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return absolutePath;
}

function stableEntries(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

async function buildProfileOracle(entry) {
  const profilePath = projectPath(entry.profile, `Profile path for '${entry.id}'`);
  const oracleJsonPath = projectPath(entry.oracle, `Oracle path for '${entry.id}'`);
  const profileText = await readFile(profilePath, "utf8");
  const profileSha256 = createHash("sha256").update(profileText).digest("hex");
  const tempDirectory = await mkdtemp(join(tmpdir(), "feral-simc-oracle-"));
  const reportPath = join(tempDirectory, "report.json");
  const textPath = join(tempDirectory, "report.txt");

  let report;
  try {
    await execFileAsync(simcPath, [
      profilePath,
      "iterations=1",
      "threads=1",
      "max_time=1",
      "vary_combat_length=0",
      "fixed_time=1",
      "seed=121069299",
      `json=${reportPath}`,
      `output=${textPath}`,
    ], { cwd: projectRoot, maxBuffer: 16 * 1024 * 1024 });
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }

  const player = report.sim?.players?.[0];
  if (!player) throw new Error(`SimulationCraft JSON did not contain a player for '${entry.id}'`);

  const input = normalizeBuildInput({ kind: "simc-profile", profileText });
  const equipment = parseEquipment(input);
  const reportGearBySlot = new Map(
    Object.entries(player.gear ?? {}).map(([sourceSlot, value]) => [canonicalSimcEquipmentSlot(sourceSlot), value]),
  );
  const itemVariants = {};

  for (const item of equipment.slots) {
    const gear = reportGearBySlot.get(item.slot);
    if (!gear) throw new Error(`SimulationCraft JSON is missing gear slot '${item.slot}' for '${entry.id}'`);
    const stats = stableEntries(
      Object.fromEntries(
        Object.entries(gear)
          .filter(([key, value]) => !["name", "encoded_item", "ilevel"].includes(key) && typeof value === "number"),
      ),
    );
    itemVariants[item.variantKey] = {
      key: item.variantKey,
      itemId: item.itemId,
      itemLevel: item.itemLevel,
      name: item.name,
      slot: item.slot,
      encodedItem: gear.encoded_item,
      stats,
      effectsStatus: "pending-m3-m5",
      sourceProfileSha256: profileSha256,
    };
  }

  const dbc = report.sim.options?.dbc?.Live ?? player.dbc?.Live;
  const oracle = {
    schemaVersion: 1,
    profileId: entry.id ?? basename(profilePath, ".simc"),
    profilePath: relative(projectRoot, profilePath),
    profileSha256,
    reportVersion: report.report_version,
    simc: {
      version: report.version,
      gameVersion: dbc?.wow_version ?? null,
      build: dbc?.build_level ?? null,
      hotfixDate: dbc?.hotfix_date ?? null,
      hotfixBuild: dbc?.hotfix_build ?? null,
      hotfixHash: dbc?.hotfix_hash ?? null,
      noNetworking: report.no_networking,
    },
    character: {
      name: player.name,
      race: player.race,
      level: player.level,
      role: player.role,
      specialization: player.specialization,
      talentCode: player.talents,
    },
    consumables: {
      potion: player.potion,
      flask: player.flask,
      food: player.food,
      augmentation: player.augmentation,
      temporaryEnchant: player.temporary_enchant,
    },
    baseEnergyRegenPerSecond: player.base_energy_regen_per_second,
    buffedStats: player.collected_data?.buffed_stats ?? null,
    itemVariantKeys: Object.keys(itemVariants).sort(),
    itemVariants: stableEntries(itemVariants),
  };

  await mkdir(dirname(oracleJsonPath), { recursive: true });
  await writeFile(oracleJsonPath, `${JSON.stringify(oracle, null, 2)}\n`, "utf8");
  return oracle;
}

const manifestPath = projectPath(optionValue("--manifest", defaultManifestPath), "Manifest path");
const generatedModulePath = projectPath(optionValue("--module", defaultGeneratedModulePath), "Generated module path");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.profiles) || manifest.profiles.length === 0) {
  throw new Error("SimC oracle manifest must be schemaVersion 1 with at least one profile");
}

const oracles = [];
const mergedItemVariants = {};
for (const entry of manifest.profiles) {
  if (!entry.id || !entry.profile || !entry.oracle) throw new Error("Each manifest profile needs id, profile and oracle");
  const oracle = await buildProfileOracle(entry);
  oracles.push(oracle);
  for (const [key, variant] of Object.entries(oracle.itemVariants)) {
    const existing = mergedItemVariants[key];
    if (existing && JSON.stringify(existing.stats) !== JSON.stringify(variant.stats)) {
      throw new Error(`Conflicting SimC stats for equipment variant '${key}'`);
    }
    mergedItemVariants[key] ??= variant;
  }
}

const first = oracles[0];
assertOracleMatchesLock(simcLock, first.simc);
for (const oracle of oracles.slice(1)) {
  assertOracleMatchesLock(simcLock, oracle.simc);
  if (
    oracle.simc.version !== first.simc.version ||
    oracle.simc.gameVersion !== first.simc.gameVersion ||
    oracle.simc.hotfixBuild !== first.simc.hotfixBuild ||
    oracle.simc.hotfixHash !== first.simc.hotfixHash
  ) {
    throw new Error("All SimC oracle profiles must use the same SimC, game and hotfix version");
  }
}

const metadata = {
  schemaVersion: 1,
  gameVersion: first.simc.gameVersion,
  simcVersion: first.simc.version,
  hotfixDate: first.simc.hotfixDate,
  hotfixBuild: first.simc.hotfixBuild,
  hotfixHash: first.simc.hotfixHash,
  versionLock: browserVersionMetadata(simcLock),
  manifestPath: relative(projectRoot, manifestPath),
  profiles: oracles.map((oracle) => ({ id: oracle.profileId, sha256: oracle.profileSha256 })),
};
const profileStatOracles = Object.fromEntries(oracles.map((oracle) => [oracle.profileSha256, {
  profileId: oracle.profileId,
  character: oracle.character,
  consumables: oracle.consumables,
  baseEnergyRegenPerSecond: oracle.baseEnergyRegenPerSecond,
  buffedStats: oracle.buffedStats,
  itemVariantKeys: oracle.itemVariantKeys,
}]));
const moduleText = `// Generated by scripts/generate-simc-profile-oracle.mjs. Do not edit manually.\n` +
  `export const SIMC_ORACLE_METADATA = Object.freeze(${JSON.stringify(metadata, null, 2)});\n\n` +
  `export const SIMC_ITEM_VARIANT_CATALOG = Object.freeze(${JSON.stringify(stableEntries(mergedItemVariants), null, 2)});\n\n` +
  `export const SIMC_PROFILE_STAT_ORACLES = Object.freeze(${JSON.stringify(profileStatOracles, null, 2)});\n`;
await mkdir(dirname(generatedModulePath), { recursive: true });
await writeFile(generatedModulePath, moduleText, "utf8");

console.log(JSON.stringify({
  manifestPath,
  generatedModulePath,
  profiles: oracles.length,
  itemVariants: Object.keys(mergedItemVariants).length,
}));
