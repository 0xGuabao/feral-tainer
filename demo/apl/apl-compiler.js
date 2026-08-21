import { validateAplIrRule } from "./apl-ir.js";

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function parseProfileRule(assignment) {
  const options = Object.fromEntries(
    assignment.valueSegments
      .filter((segment) => segment.kind === "option")
      .map((segment) => [segment.key, segment.value]),
  );
  return {
    fieldId: `line:${assignment.lineNumber}:${assignment.key}`,
    lineNumber: assignment.lineNumber,
    rawLine: assignment.raw,
    list: assignment.key === "actions" ? "default" : assignment.key.slice("actions.".length),
    simcAction: (assignment.valueSegments[0]?.value ?? "").replace(/^\/+/, ""),
    condition: options.if ?? null,
    targetIf: options.target_if ?? null,
    options,
  };
}

function sameSourceBinding(rule, profileRule) {
  return rule.source.list === profileRule.list &&
    rule.source.simcAction === profileRule.simcAction &&
    (rule.source.condition ?? null) === profileRule.condition &&
    (rule.source.targetIf ?? null) === profileRule.targetIf;
}

function unsupportedReason(profileRule, catalog) {
  const sameAction = catalog.filter((rule) =>
    rule.source.list === profileRule.list && rule.source.simcAction === profileRule.simcAction);
  if (["call_action_list", "variable"].includes(profileRule.simcAction)) {
    return {
      reasonCode: "control_flow_not_whitelisted",
      reason: "该 SimC APL 控制流或变量规则尚未进入交互训练器白名单 IR。",
    };
  }
  if (sameAction.length > 0) {
    return {
      reasonCode: "condition_not_whitelisted",
      reason: "动作已知，但该条件或 target_if 尚未翻译为经过测试的白名单 IR。",
    };
  }
  return {
    reasonCode: "action_or_command_not_supported",
    reason: "该 SimC APL 动作或命令尚未进入交互训练器 APL Catalog。",
  };
}

function createUnsupportedAplRule(profileRule, catalog) {
  const detail = unsupportedReason(profileRule, catalog);
  return {
    schemaVersion: 1,
    ruleId: `profile-apl:${profileRule.fieldId}`,
    sourceKind: "simc-profile-apl",
    list: profileRule.list,
    action: profileRule.simcAction,
    condition: profileRule.condition,
    targetIf: profileRule.targetIf,
    options: clone(profileRule.options),
    lineNumber: profileRule.lineNumber,
    rawLine: profileRule.rawLine,
    reasonCode: detail.reasonCode,
    reason: detail.reason,
    impact: "recommendation-fidelity",
    evidenceRefs: [`SimC profile line ${profileRule.lineNumber}`],
  };
}

function resolveCatalog(catalog, replacements) {
  return catalog.map((rule) => ({
    ...clone(rule),
    actionId: replacements.get(rule.actionId) ?? rule.actionId,
  }));
}

export function compileApl({ catalog, simcProfile, availableActionIds, replacements }) {
  const resolvedCatalog = resolveCatalog(catalog, replacements);
  for (const rule of resolvedCatalog) {
    const errors = validateAplIrRule(rule);
    if (errors.length) throw new Error(`Invalid APL IR rule '${rule.id}': ${errors.join("; ")}`);
  }

  const assignments = (simcProfile?.assignments ?? []).filter((assignment) => assignment.fieldKind === "action-list");
  if (assignments.length === 0) {
    return {
      schemaVersion: 1,
      source: "authored-default",
      rules: resolvedCatalog.filter((rule) => availableActionIds.has(rule.actionId)),
      filteredRules: resolvedCatalog
        .filter((rule) => !availableActionIds.has(rule.actionId))
        .map((rule) => ({ ruleId: rule.id, actionId: rule.actionId, reason: "action-unavailable-in-resolved-profile" })),
      unsupportedRules: [],
      consumedFieldIds: [],
      profileRuleCount: 0,
      accountedProfileRuleCount: 0,
    };
  }

  const profileRules = assignments.map(parseProfileRule);
  const matchedByRuleId = new Map();
  const unsupportedRules = [];
  for (const profileRule of profileRules) {
    const matched = resolvedCatalog.find((rule) => sameSourceBinding(rule, profileRule));
    if (!matched || matchedByRuleId.has(matched.id)) {
      unsupportedRules.push(createUnsupportedAplRule(profileRule, resolvedCatalog));
      continue;
    }
    matchedByRuleId.set(matched.id, profileRule);
  }

  const matchedCatalog = resolvedCatalog.filter((rule) => matchedByRuleId.has(rule.id));
  const rules = matchedCatalog
    .filter((rule) => availableActionIds.has(rule.actionId))
    .map((rule) => ({
      ...rule,
      profileSource: {
        lineNumber: matchedByRuleId.get(rule.id).lineNumber,
        rawLine: matchedByRuleId.get(rule.id).rawLine,
      },
    }));
  const filteredRules = matchedCatalog
    .filter((rule) => !availableActionIds.has(rule.actionId))
    .map((rule) => ({
      ruleId: rule.id,
      actionId: rule.actionId,
      lineNumber: matchedByRuleId.get(rule.id).lineNumber,
      reason: "action-unavailable-in-resolved-profile",
    }));

  return {
    schemaVersion: 1,
    source: "simc-profile",
    rules,
    filteredRules,
    unsupportedRules,
    consumedFieldIds: profileRules.map((rule) => rule.fieldId),
    profileRuleCount: profileRules.length,
    accountedProfileRuleCount: rules.length + filteredRules.length + unsupportedRules.length,
  };
}
