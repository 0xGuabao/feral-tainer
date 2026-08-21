import { createUnsupportedField, deepFreeze, invariant } from "./contracts.js";

export const SIMC_PROFILE_AST_SCHEMA_VERSION = 1;

const ACTOR_KEYS = new Set([
  "deathknight",
  "demonhunter",
  "druid",
  "evoker",
  "hunter",
  "mage",
  "monk",
  "paladin",
  "priest",
  "rogue",
  "shaman",
  "warlock",
  "warrior",
]);

export const SIMC_EQUIPMENT_SLOT_ALIASES = Object.freeze({
  head: "head",
  neck: "neck",
  shoulder: "shoulder",
  shoulders: "shoulder",
  back: "back",
  chest: "chest",
  shirt: "shirt",
  tabard: "tabard",
  wrist: "wrist",
  wrists: "wrist",
  hands: "hands",
  waist: "waist",
  legs: "legs",
  feet: "feet",
  finger1: "finger1",
  finger2: "finger2",
  trinket1: "trinket1",
  trinket2: "trinket2",
  main_hand: "main_hand",
  off_hand: "off_hand",
});

const CHARACTER_KEYS = new Set([
  "level",
  "race",
  "role",
  "position",
  "professions",
  "skill",
  "bugs",
  "region",
  "server",
  "origin",
  "thumbnail",
]);

const CONSUMABLE_KEYS = new Set([
  "potion",
  "flask",
  "food",
  "augmentation",
  "temporary_enchant",
]);

const SIMULATION_OPTION_KEYS = new Set([
  "iterations",
  "desired_targets",
  "max_time",
  "vary_combat_length",
  "fight_style",
  "calculate_scale_factors",
  "scale_only",
  "default_world_lag",
  "optimal_raid",
  "timeofday",
]);

const APPLIED_KEYS = new Set(["druid", "spec", "talents"]);

function unquote(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

function splitCommaSeparated(value) {
  const parts = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts;
}

function parseValueSegments(value) {
  return splitCommaSeparated(value).map((raw, index) => {
    const separator = raw.indexOf("=");
    if (index === 0 || separator < 1) {
      return { kind: index === 0 ? "primary" : "flag", raw, value: unquote(raw) };
    }
    return {
      kind: "option",
      raw,
      key: raw.slice(0, separator).trim().toLowerCase(),
      value: unquote(raw.slice(separator + 1).trim()),
    };
  });
}

function classifyField(key) {
  if (ACTOR_KEYS.has(key)) return "actor";
  if (key === "spec" || key === "talents") return "build";
  if (SIMC_EQUIPMENT_SLOT_ALIASES[key]) return "equipment";
  if (key === "set_bonus") return "set-bonus";
  if (key === "actions" || key.startsWith("actions.")) return "action-list";
  if (CHARACTER_KEYS.has(key)) return "character";
  if (CONSUMABLE_KEYS.has(key)) return "consumable";
  if (SIMULATION_OPTION_KEYS.has(key) || key.startsWith("override.")) return "simulation-option";
  if (key === "source") return "profile-metadata";
  if (key === "copy" || key.startsWith("profileset.")) return "profile-control";
  return "unknown";
}

function unsupportedReason(node) {
  if (node.type === "invalid") {
    return "该行不是可识别的 SimC 赋值语句，已保留原文但尚未应用。";
  }
  const reasons = {
    actor: "当前阶段只应用 druid 角色名；其他角色声明尚未进入 ResolvedProfile。",
    equipment: "装备字段已解析并保留，等待 EquipmentResolver 应用。",
    "set-bonus": "Profile 内套装字段已解析并保留，等待 SetBonusResolver 应用。",
    "action-list": "APL 字段已解析并保留，等待 APLCompiler 应用。",
    character: "人物字段已解析并保留，等待 Character/StatResolver 应用。",
    consumable: "消耗品字段已解析并保留，等待 ItemResolver 应用。",
    "simulation-option": "模拟选项已解析并保留，但交互训练会话尚未消费该字段。",
    "profile-control": "Profile 控制字段已解析并保留，但尚未实现对应语义。",
    "profile-metadata": "Profile 元数据已解析并保留，等待 ResolvedProfile 应用。",
    unknown: "该 SimC 字段尚未分类或实现。",
  };
  return reasons[node.fieldKind] ?? reasons.unknown;
}

export function canonicalSimcEquipmentSlot(key) {
  return SIMC_EQUIPMENT_SLOT_ALIASES[key.toLowerCase()] ?? null;
}

function unsupportedImpact(node) {
  if (node.type === "invalid" || node.fieldKind === "unknown") return "unknown";
  if (node.fieldKind === "simulation-option" || node.fieldKind === "profile-control") return "session-or-import-semantics";
  return "combat-or-build-semantics";
}

export function parseSimcProfile(profileText) {
  invariant(typeof profileText === "string", "SimC profile text is required");
  const rawLines = profileText.split(/\r?\n/);
  const nodes = rawLines.map((raw, index) => {
    const lineNumber = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return { type: "blank", lineNumber, raw };
    if (trimmed.startsWith("#")) {
      return { type: "comment", lineNumber, raw, text: trimmed.slice(1).trim() };
    }

    const match = trimmed.match(/^([^=+\s]+)\s*(\+=|=)\s*(.*)$/);
    if (!match) return { type: "invalid", lineNumber, raw, reason: "missing-assignment-operator" };

    const rawKey = match[1];
    const key = rawKey.toLowerCase();
    const operator = match[2];
    const rawValue = match[3].trim();
    const value = unquote(rawValue);
    return {
      type: "assignment",
      lineNumber,
      raw,
      rawKey,
      key,
      operator,
      rawValue,
      value,
      valueSegments: parseValueSegments(rawValue),
      fieldKind: classifyField(key),
      supportStatus: APPLIED_KEYS.has(key) ? "applied" : "deferred",
    };
  });

  const assignments = nodes.filter((node) => node.type === "assignment");
  const valuesByKey = {};
  const sourceMap = {};
  for (const assignment of assignments) {
    (valuesByKey[assignment.key] ??= []).push(assignment.value);
    (sourceMap[assignment.key] ??= []).push({
      lineNumber: assignment.lineNumber,
      operator: assignment.operator,
      rawValue: assignment.rawValue,
      value: assignment.value,
    });
  }

  const unsupportedFields = nodes
    .filter((node) => node.type === "invalid" || (node.type === "assignment" && node.supportStatus !== "applied"))
    .map((node) => createUnsupportedField({
      fieldId: node.type === "assignment"
        ? `line:${node.lineNumber}:${node.key}`
        : `line:${node.lineNumber}:invalid`,
      key: node.key,
      operator: node.operator,
      value: node.value,
      rawValue: node.rawValue,
      lineNumber: node.lineNumber,
      rawLine: node.raw,
      fieldKind: node.fieldKind ?? "malformed",
      reason: unsupportedReason(node),
      impact: unsupportedImpact(node),
    }));

  return deepFreeze({
    schemaVersion: SIMC_PROFILE_AST_SCHEMA_VERSION,
    lineEnding: profileText.includes("\r\n") ? "crlf" : "lf",
    rawText: profileText,
    nodes,
    assignments,
    valuesByKey,
    sourceMap,
    unsupportedFields,
  });
}

export function getProfileAssignments(profile, key) {
  return profile.assignments.filter((assignment) => assignment.key === key.toLowerCase());
}

export function getLastProfileValue(profile, key) {
  const values = profile.valuesByKey[key.toLowerCase()] ?? [];
  return values.at(-1);
}
