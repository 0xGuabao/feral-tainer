import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export const CHANGE_CATEGORIES = Object.freeze([
  "version_only",
  "talent",
  "action_number_or_resource",
  "timing_or_cooldown",
  "aura_or_dot",
  "apl",
  "tier_set",
  "gear_or_trinket",
  "new_generic_mechanism",
  "custom_mechanism_candidate",
  "unknown",
]);

export const SCAN_PATHS = Object.freeze([
  "engine/class_modules/sc_druid.cpp",
  "engine/class_modules/apl/druid/feral_apl.inc",
  "engine/dbc/generated/trait_data.inc",
  "engine/dbc/generated/sc_spell_data.inc",
  "engine/dbc/generated/item_set_bonus.inc",
  "engine/dbc/generated/item_effect.inc",
  "engine/player/unique_gear_midnight.cpp",
]);

const mechanismPattern = /\b(rppm|ppm|internal_cooldown|accumulator|replace_action|(?:dbc_)?proc_callback_t|stack_change_callback|on_[a-z_]+|create_proc_action|create_buff|action_list\.push_back)\b/i;
const customPattern = /\b(make_event|schedule_execute|register_callback|execute_action|custom(?:_|\s)?handler|update_player_buff_stat|register_special_effect|rng\(\)\.range)\b|\bstruct\s+\w+\s*:\s*public\b|\bvoid\s+execute\s*\(/i;
const timingPattern = /\b(cooldown|duration|tick(?:_time)?|period|gcd|execute_time|travel_time|refresh_duration|expire)\b/i;
const auraPattern = /\b(aura|buff|debuff|dot|bleed|stack|refresh|consume)\b/i;
const resourcePattern = /\b(energy|combo_point|resource|cost|gain|base_value|percent|coefficient|spell_power|attack_power)\b/i;

export function classifyChange(path, line, kind = "added") {
  if (/wow build(?: level)?\s+\d/i.test(line) || /CLIENT_DATA_(?:WOW_VERSION|BUILD)/.test(line)) return "version_only";
  if (path.endsWith("feral_apl.inc")) return "apl";
  if (path.endsWith("trait_data.inc")) return "talent";
  if (path.endsWith("item_set_bonus.inc")) return "tier_set";
  if (path.endsWith("item_effect.inc")) return "gear_or_trinket";
  if (path.endsWith("unique_gear_midnight.cpp")) {
    if (kind === "added" && customPattern.test(line)) return "custom_mechanism_candidate";
    if (kind === "added" && mechanismPattern.test(line)) return "new_generic_mechanism";
    if (timingPattern.test(line)) return "timing_or_cooldown";
    if (auraPattern.test(line)) return "aura_or_dot";
    return "gear_or_trinket";
  }
  if (path.endsWith("sc_druid.cpp")) {
    if (kind === "added" && customPattern.test(line)) return "custom_mechanism_candidate";
    if (kind === "added" && mechanismPattern.test(line)) return "new_generic_mechanism";
    if (timingPattern.test(line)) return "timing_or_cooldown";
    if (auraPattern.test(line)) return "aura_or_dot";
    if (resourcePattern.test(line)) return "action_number_or_resource";
    return "action_number_or_resource";
  }
  if (path.endsWith("sc_spell_data.inc")) {
    if (timingPattern.test(line)) return "timing_or_cooldown";
    if (auraPattern.test(line)) return "aura_or_dot";
    return "action_number_or_resource";
  }
  return "unknown";
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fileMetadata(path) {
  const [info, hash] = await Promise.all([stat(path), sha256(path)]);
  const prefix = (await readFile(path, "utf8")).slice(0, 512);
  const buildMatch = prefix.match(/wow build(?: level)?\s+(\d+\.\d+\.\d+\.(\d+))/i);
  return {
    bytes: info.size,
    sha256: hash,
    wowVersion: buildMatch?.[1] ?? null,
    wowBuild: buildMatch ? Number(buildMatch[2]) : null,
  };
}

function blankCategoryCounts() {
  return Object.fromEntries(CHANGE_CATEGORIES.map((category) => [category, 0]));
}

const genericAplActions = new Set([
  "auto_attack",
  "cancel_buff",
  "flask",
  "food",
  "pool_resource",
  "potion",
  "snapshot_stats",
  "use_item",
  "variable",
]);

function aplActionReferences(contents) {
  const references = new Set();
  for (const match of contents.matchAll(/add_action\(\s*"([^"]+)"/g)) {
    const action = match[1].split(",", 1)[0].trim();
    if (action) references.add(action);
  }
  return [...references].sort();
}

async function auditAplReferences(baseRoot, targetRoot) {
  const aplPath = "engine/class_modules/apl/druid/feral_apl.inc";
  const druidPath = "engine/class_modules/sc_druid.cpp";
  const [baseApl, targetApl, targetDruid] = await Promise.all([
    readFile(resolve(baseRoot, aplPath), "utf8"),
    readFile(resolve(targetRoot, aplPath), "utf8"),
    readFile(resolve(targetRoot, druidPath), "utf8"),
  ]);
  const baseReferences = aplActionReferences(baseApl);
  const targetReferences = aplActionReferences(targetApl);
  const baseSet = new Set(baseReferences);
  const newReferences = targetReferences.filter((action) => !baseSet.has(action));
  const missingActionReferences = newReferences.filter((action) => (
    !genericAplActions.has(action) &&
    !targetDruid.includes(`"${action}"`)
  ));
  return {
    baseReferenceCount: baseReferences.length,
    targetReferenceCount: targetReferences.length,
    newReferences,
    missingActionReferences,
  };
}

function truncate(value, maximum = 500) {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}

async function diffFile(path, basePath, targetPath) {
  const categories = blankCategoryCounts();
  const samples = Object.fromEntries(CHANGE_CATEGORIES.map((category) => [category, []]));
  let additions = 0;
  let deletions = 0;
  let pending = "";

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["diff", "--no-index", "--unified=0", "--no-color", "--", basePath, targetPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      const lines = `${pending}${chunk}`.split("\n");
      pending = lines.pop() ?? "";
      for (const rawLine of lines) consume(rawLine);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (pending) consume(pending);
      if (code !== 0 && code !== 1) rejectPromise(new Error(`git diff failed for ${path}: ${stderr.trim()}`));
      else resolvePromise();
    });
  });

  function consume(rawLine) {
    if (!rawLine || rawLine.startsWith("+++ ") || rawLine.startsWith("--- ") || rawLine.startsWith("@@")) return;
    const marker = rawLine[0];
    if (marker !== "+" && marker !== "-") return;
    const kind = marker === "+" ? "added" : "removed";
    if (kind === "added") additions += 1;
    else deletions += 1;
    const text = rawLine.slice(1);
    const category = classifyChange(path, text, kind);
    categories[category] += 1;
    if (samples[category].length < 6) samples[category].push({ kind, text: truncate(text) });
  }

  return {
    additions,
    deletions,
    changedLineCount: additions + deletions,
    categories,
    samples: Object.fromEntries(Object.entries(samples).filter(([, values]) => values.length)),
  };
}

export function applyMechanismReview(review, totals, targetMetadata) {
  const mechanismCounts = {
    new_generic_mechanism: totals.new_generic_mechanism,
    custom_mechanism_candidate: totals.custom_mechanism_candidate,
  };
  const detectedLineCount = Object.values(mechanismCounts).reduce((sum, count) => sum + count, 0);
  if (!review) {
    return {
      status: "not_supplied",
      detectedLineCount,
      reviewedLineCount: 0,
      unreviewedLineCount: detectedLineCount,
      reviewedCategories: {},
      semanticGroups: [],
    };
  }
  if (review.schemaVersion !== 1) throw new Error("Mechanism review schemaVersion must be 1");
  if (review.targetCommit !== targetMetadata.simcCommit) {
    throw new Error(`Mechanism review targetCommit mismatch: review=${review.targetCommit}, target=${targetMetadata.simcCommit}`);
  }
  for (const [category, actualLineCount] of Object.entries(mechanismCounts)) {
    const expectedLineCount = review.reviewedCategories?.[category]?.expectedLineCount;
    if (expectedLineCount !== actualLineCount) {
      throw new Error(`Mechanism review drift for ${category}: review=${expectedLineCount}, scan=${actualLineCount}`);
    }
  }
  if (!Array.isArray(review.semanticGroups) || review.semanticGroups.length === 0) {
    throw new Error("Mechanism review must contain semanticGroups");
  }
  const reviewedLineCount = Object.values(review.reviewedCategories)
    .reduce((sum, category) => sum + category.expectedLineCount, 0);
  return {
    status: "reviewed",
    reviewId: review.reviewId,
    reviewedAt: review.reviewedAt,
    targetCommit: review.targetCommit,
    detectedLineCount,
    reviewedLineCount,
    unreviewedLineCount: detectedLineCount - reviewedLineCount,
    reviewedCategories: review.reviewedCategories,
    semanticGroups: review.semanticGroups,
  };
}

export async function scanSimcRoots({
  baseRoot,
  targetRoot,
  baseMetadata,
  targetMetadata,
  mechanismReview = null,
}) {
  const files = [];
  const totals = blankCategoryCounts();

  for (const path of SCAN_PATHS) {
    const basePath = resolve(baseRoot, path);
    const targetPath = resolve(targetRoot, path);
    const [base, target] = await Promise.all([fileMetadata(basePath), fileMetadata(targetPath)]);
    const changed = base.sha256 !== target.sha256;
    const diff = changed ? await diffFile(path, basePath, targetPath) : {
      additions: 0,
      deletions: 0,
      changedLineCount: 0,
      categories: blankCategoryCounts(),
      samples: {},
    };
    for (const category of CHANGE_CATEGORIES) totals[category] += diff.categories[category];
    files.push({ path, changed, base, target, ...diff });
  }

  const changedLineCount = Object.values(totals).reduce((sum, count) => sum + count, 0);
  const silentUnsupportedDropCount = changedLineCount - Object.values(totals).reduce((sum, count) => sum + count, 0);
  const aplReferenceAudit = await auditAplReferences(baseRoot, targetRoot);
  const mechanismReviewResult = applyMechanismReview(mechanismReview, totals, targetMetadata);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "WoW 12.1 Feral SimulationCraft update scan",
    base: baseMetadata,
    target: targetMetadata,
    scannedPaths: SCAN_PATHS,
    categories: totals,
    files,
    aplReferenceAudit,
    mechanismReview: mechanismReviewResult,
    summary: {
      scannedFileCount: files.length,
      changedFileCount: files.filter((file) => file.changed).length,
      unchangedFileCount: files.filter((file) => !file.changed).length,
      changedLineCount,
      unknownChangeLineCount: totals.unknown,
      reviewedMechanismCount: mechanismReviewResult.reviewedLineCount,
      unreviewedMechanismCount: mechanismReviewResult.unreviewedLineCount,
      silentUnsupportedDropCount,
      aplReferencesMissingActionCount: aplReferenceAudit.missingActionReferences.length,
      resolvedProfileImpact: "not_evaluated_by_scanner",
      releaseGate: mechanismReviewResult.unreviewedLineCount || totals.unknown || aplReferenceAudit.missingActionReferences.length
        ? "blocked_pending_semantic_review"
        : "g1_scan_passed_target_not_promoted",
    },
  };
}
