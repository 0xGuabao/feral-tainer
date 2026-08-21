const EPSILON = 0.0001;

export const APL_IR_OPERATORS = Object.freeze([
  "and", "or", "not", "eq", "ne", "lt", "lte", "gt", "gte",
  "add", "multiply", "min", "if", "in",
]);

export const APL_IR_VALUE_KINDS = Object.freeze([
  "target_count",
  "combo_points",
  "fight_remaining_ms",
  "last_gcd_action_id",
  "aura_up",
  "aura_remaining",
  "cooldown_remaining",
  "dot_remaining",
  "dot_refreshable",
  "dot_up",
  "refreshable_dot_count",
  "non_refreshable_dot_count",
  "talent_selected",
  "action_available",
  "action_channel_duration",
  "action_channel_field",
]);

export const APL_IR_TARGET_KINDS = Object.freeze(["none", "active", "index", "dot"]);

function resolveActionId(reference, context) {
  if (reference === "$rule") return context.rule.actionId;
  if (typeof reference === "string" && reference.startsWith("$replacement:")) {
    const baseActionId = reference.slice("$replacement:".length);
    return context.profile.replacements[baseActionId] ?? baseActionId;
  }
  return reference;
}

function resolveTargetIndex(reference, context) {
  if (reference === "$selected") return context.targetIndex;
  if (reference === "$active") return context.view.activeTargetIndex;
  return Number.isInteger(reference) ? reference : context.view.activeTargetIndex;
}

function dotFor(expression, context) {
  const targetIndex = resolveTargetIndex(expression.target, context);
  return context.view.targets[targetIndex]?.dots?.[expression.dotId] ?? null;
}

function actionChannelField(expression, context) {
  const actionId = resolveActionId(expression.actionId, context);
  let value = context.profile.actionById[actionId]?.channel;
  for (const key of expression.path ?? []) value = value?.[key];
  return value ?? null;
}

function resolveValue(expression, context) {
  switch (expression.value) {
    case "target_count": return context.view.targetCount;
    case "combo_points": return context.view.comboPoints;
    case "fight_remaining_ms": return context.view.fightRemainingMs;
    case "last_gcd_action_id": return context.view.lastGcdActionId;
    case "aura_up": return context.view.hasAura(expression.auraId);
    case "aura_remaining": return context.view.auraRemaining(expression.auraId);
    case "cooldown_remaining": return context.view.cooldownRemaining(resolveActionId(expression.actionId, context));
    case "dot_remaining": return context.view.dotRemaining(dotFor(expression, context));
    case "dot_refreshable": return context.view.dotRefreshable(dotFor(expression, context));
    case "dot_up": return context.view.dotRemaining(dotFor(expression, context)) > EPSILON;
    case "refreshable_dot_count": return context.view.targets.filter(
      (target) => context.view.dotRefreshable(target.dots?.[expression.dotId] ?? null),
    ).length;
    case "non_refreshable_dot_count": return context.view.targets.filter(
      (target) => !context.view.dotRefreshable(target.dots?.[expression.dotId] ?? null),
    ).length;
    case "talent_selected": return Boolean(context.profile.build.talents.byToken[expression.token]);
    case "action_available": return Boolean(context.profile.actionById[resolveActionId(expression.actionId, context)]);
    case "action_channel_duration": {
      const actionId = resolveActionId(expression.actionId, context);
      return context.profile.actionById[actionId]?.channel?.durationMs ?? 0;
    }
    case "action_channel_field": return actionChannelField(expression, context);
    default: throw new Error(`Unsupported APL IR value '${expression.value}'`);
  }
}

export function evaluateAplExpression(expression, context) {
  if (expression == null || typeof expression !== "object") return expression;
  if (Object.hasOwn(expression, "value") && typeof expression.value === "string") {
    return resolveValue(expression, context);
  }

  const operands = () => expression.values.map((entry) => evaluateAplExpression(entry, context));
  const left = () => evaluateAplExpression(expression.left, context);
  const right = () => evaluateAplExpression(expression.right, context);
  switch (expression.op) {
    case "and": return expression.values.every((entry) => Boolean(evaluateAplExpression(entry, context)));
    case "or": return expression.values.some((entry) => Boolean(evaluateAplExpression(entry, context)));
    case "not": return !evaluateAplExpression(expression.value, context);
    case "eq": return left() === right();
    case "ne": return left() !== right();
    case "lt": return left() < right();
    case "lte": return left() <= right();
    case "gt": return left() > right();
    case "gte": return left() >= right();
    case "add": return operands().reduce((total, value) => total + Number(value), 0);
    case "multiply": return operands().reduce((total, value) => total * Number(value), 1);
    case "min": return Math.min(...operands().map(Number));
    case "if": return evaluateAplExpression(expression.condition, context)
      ? evaluateAplExpression(expression.whenTrue, context)
      : evaluateAplExpression(expression.whenFalse, context);
    case "in": return expression.values.includes(evaluateAplExpression(expression.value, context));
    default: throw new Error(`Unsupported APL IR operator '${expression.op}'`);
  }
}

function findDotTarget(view, selector) {
  const candidates = view.targets.map((target) => ({
    index: target.index,
    dot: target.dots?.[selector.dotId] ?? null,
    remains: view.dotRemaining(target.dots?.[selector.dotId] ?? null),
  }));
  const filtered = selector.mode === "refreshable_minimum"
    ? candidates.filter((entry) => view.dotRefreshable(entry.dot))
    : candidates;
  filtered.sort((left, right) => left.remains - right.remains || left.index - right.index);
  if (filtered.length) return { matched: true, targetIndex: filtered[0].index };
  if (selector.fallback === "active") return { matched: true, targetIndex: view.activeTargetIndex };
  return { matched: false, targetIndex: null };
}

export function selectAplTarget(selector, context) {
  switch (selector.kind) {
    case "none": return { matched: true, targetIndex: null };
    case "active": return { matched: true, targetIndex: context.view.activeTargetIndex };
    case "index": return context.view.targets[selector.index]
      ? { matched: true, targetIndex: selector.index }
      : { matched: false, targetIndex: null };
    case "dot": return findDotTarget(context.view, selector);
    default: throw new Error(`Unsupported APL IR target selector '${selector.kind}'`);
  }
}

function resolveReason(reason, context) {
  if (typeof reason === "string") return reason;
  for (const candidate of reason.cases ?? []) {
    if (evaluateAplExpression(candidate.when, context)) return candidate.text;
  }
  return reason.fallback;
}

export function matchAplRule(rule, { view, profile }) {
  const baseContext = { view, profile, rule, targetIndex: null };
  const selected = selectAplTarget(rule.ir.target, baseContext);
  if (!selected.matched) return null;
  const context = { ...baseContext, targetIndex: selected.targetIndex };
  if (!evaluateAplExpression(rule.ir.when, context)) return null;
  return {
    targetIndex: selected.targetIndex,
    reason: resolveReason(rule.ir.reason, context),
  };
}

function validateExpression(expression, path, errors) {
  if (expression == null || typeof expression !== "object") return;
  if (Object.hasOwn(expression, "value") && typeof expression.value === "string" && !expression.op) {
    if (!APL_IR_VALUE_KINDS.includes(expression.value)) errors.push(`${path}: unknown value '${expression.value}'`);
    return;
  }
  if (!APL_IR_OPERATORS.includes(expression.op)) {
    errors.push(`${path}: unknown operator '${expression.op}'`);
    return;
  }
  if (["and", "or", "add", "multiply", "min"].includes(expression.op)) {
    if (!Array.isArray(expression.values) || expression.values.length === 0) errors.push(`${path}: values must be non-empty`);
    for (const [index, nested] of (expression.values ?? []).entries()) validateExpression(nested, `${path}.values[${index}]`, errors);
  } else if (["eq", "ne", "lt", "lte", "gt", "gte"].includes(expression.op)) {
    validateExpression(expression.left, `${path}.left`, errors);
    validateExpression(expression.right, `${path}.right`, errors);
  } else if (expression.op === "not") {
    validateExpression(expression.value, `${path}.value`, errors);
  } else if (expression.op === "if") {
    validateExpression(expression.condition, `${path}.condition`, errors);
    validateExpression(expression.whenTrue, `${path}.whenTrue`, errors);
    validateExpression(expression.whenFalse, `${path}.whenFalse`, errors);
  } else if (expression.op === "in") {
    validateExpression(expression.value, `${path}.value`, errors);
    if (!Array.isArray(expression.values)) errors.push(`${path}.values must be an array`);
  }
}

export function validateAplIrRule(rule) {
  const errors = [];
  if (rule?.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!rule?.id || !rule?.actionId) errors.push("id and actionId are required");
  if (!APL_IR_TARGET_KINDS.includes(rule?.ir?.target?.kind)) errors.push(`unknown target selector '${rule?.ir?.target?.kind}'`);
  validateExpression(rule?.ir?.when, "ir.when", errors);
  for (const [index, candidate] of (rule?.ir?.reason?.cases ?? []).entries()) {
    validateExpression(candidate.when, `ir.reason.cases[${index}].when`, errors);
  }
  return errors;
}
