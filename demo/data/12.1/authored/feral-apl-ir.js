const EPSILON = 0.0001;

const value = (kind, options = {}) => ({ value: kind, ...options });
const operation = (op, values) => ({ op, values });
const and = (...values) => operation("and", values);
const or = (...values) => operation("or", values);
const not = (operand) => ({ op: "not", value: operand });
const compare = (op, left, right) => ({ op, left, right });
const add = (...values) => operation("add", values);
const multiply = (...values) => operation("multiply", values);
const minimum = (...values) => operation("min", values);
const choose = (condition, whenTrue, whenFalse) => ({ op: "if", condition, whenTrue, whenFalse });
const includes = (operand, values) => ({ op: "in", value: operand, values });

const target = Object.freeze({
  none: { kind: "none" },
  active: { kind: "active" },
  first: { kind: "index", index: 0 },
  minimumRip: { kind: "dot", dotId: "rip", mode: "minimum_remaining", fallback: "active" },
  refreshableRip: { kind: "dot", dotId: "rip", mode: "refreshable_minimum", fallback: "none" },
  refreshableRake: { kind: "dot", dotId: "rake", mode: "refreshable_minimum", fallback: "none" },
  refreshableMoonfire: { kind: "dot", dotId: "moonfire", mode: "refreshable_minimum", fallback: "none" },
});

function deepFreeze(valueToFreeze) {
  if (!valueToFreeze || typeof valueToFreeze !== "object" || Object.isFrozen(valueToFreeze)) return valueToFreeze;
  Object.freeze(valueToFreeze);
  for (const nested of Object.values(valueToFreeze)) deepFreeze(nested);
  return valueToFreeze;
}

function rule({ id, actionId, list, line, simcAction, sourceCondition = null, targetIf = null, fidelity, targetSelector, when, reason }) {
  return {
    schemaVersion: 1,
    id,
    actionId,
    list,
    line,
    fidelity,
    source: {
      kind: "simc-feral-apl",
      sourceRef: `vendor/simc/engine/class_modules/apl/druid/feral_apl.inc:${line}`,
      list,
      simcAction,
      condition: sourceCondition,
      targetIf,
    },
    ir: {
      target: targetSelector,
      when,
      reason,
    },
  };
}

const targetCount = value("target_count");
const comboPoints = value("combo_points");
const ruleCooldown = value("cooldown_remaining", { actionId: "$rule" });
const tigersFuryUp = value("aura_up", { auraId: "tigersFury" });
const berserkUp = value("aura_up", { auraId: "berserk" });

export const FERAL_APL_IR = deepFreeze([
  rule({
    id: "default.tigers_fury",
    actionId: "tigersFury",
    list: "default",
    line: 23,
    simcAction: "tigers_fury",
    sourceCondition: "(cooldown.bs_inc.remains<=1|cooldown.bs_inc.remains>10|variable.holdBerserk)&(cooldown.frantic_frenzy.remains<buff.tigers_fury.duration-1.5|cooldown.frantic_frenzy.remains>22|!talent.frantic_frenzy|spell_targets=1|fight_style.dungeonroute|fight_style.dungeonslice)",
    fidelity: "simplified",
    targetSelector: target.none,
    when: compare("lte", ruleCooldown, EPSILON),
    reason: "按当前构筑 APL 使用猛虎之怒；增伤、战略灌注与追猎收益优先于回能防溢出",
  }),
  rule({
    id: "default.stealth_rake",
    actionId: "rake",
    list: "default",
    line: 24,
    simcAction: "rake",
    sourceCondition: "buff.prowl.up|buff.shadowmeld.up",
    fidelity: "exact",
    targetSelector: target.active,
    when: value("aura_up", { auraId: "prowl" }),
    reason: "潜行起手：使用强化斜掠",
  }),
  rule({
    id: "cooldown.berserk",
    actionId: "berserk",
    list: "cooldown",
    line: 82,
    simcAction: "berserk",
    sourceCondition: "buff.tigers_fury.up&!variable.holdBerserk",
    fidelity: "subset",
    targetSelector: target.none,
    when: and(tigersFuryUp, compare("lte", ruleCooldown, EPSILON)),
    reason: "猛虎之怒窗口已开启，进入狂暴",
  }),
  rule({
    id: "cooldown.feral_frenzy",
    actionId: "feralFrenzy",
    list: "cooldown",
    line: 83,
    simcAction: "feral_frenzy",
    sourceCondition: "!talent.frantic_frenzy&combo_points<=2+(2*buff.bs_inc.up)",
    fidelity: "subset",
    targetSelector: target.active,
    when: and(
      compare("lte", ruleCooldown, EPSILON),
      compare("lte", comboPoints, choose(berserkUp, 4, 2)),
    ),
    reason: "当前连击点满足狂乱爆发阈值",
  }),
  rule({
    id: "cooldown.convoke",
    actionId: "convoke",
    list: "cooldown",
    line: 85,
    simcAction: "convoke_the_spirits",
    sourceCondition: "(buff.bs_inc.up|talent.ashamanes_guidance&(cooldown.bs_inc.remains>45|variable.holdBerserk))&buff.tigers_fury.up&(prev_gcd.1.rip|prev_gcd.1.ferocious_bite|prev_gcd.1.primal_wrath|buff.tigers_fury.remains<=1+action.convoke_the_spirits.execute_time)|fight_remains<5",
    fidelity: "simplified",
    targetSelector: target.active,
    when: or(
      and(
        compare("lte", ruleCooldown, EPSILON),
        tigersFuryUp,
        or(
          berserkUp,
          and(
            value("action_channel_field", { actionId: "$rule", path: ["parameters", "guidance"] }),
            compare("gt", value("cooldown_remaining", { actionId: "$replacement:berserk" }), 45000),
          ),
        ),
        or(
          includes(value("last_gcd_action_id"), ["rip", "ferociousBite", "primalWrath"]),
          compare(
            "lte",
            value("aura_remaining", { auraId: "tigersFury" }),
            add(1000, value("action_channel_duration", { actionId: "$rule" })),
          ),
        ),
      ),
      and(compare("lt", value("fight_remaining_ms"), 5000), compare("lte", ruleCooldown, EPSILON)),
    ),
    reason: {
      cases: [{
        when: and(
          value("action_channel_field", { actionId: "$rule", path: ["parameters", "guidance"] }),
          not(berserkUp),
        ),
        text: "阿莎曼的指引允许万灵与本轮狂暴错开",
      }],
      fallback: "猛虎之怒与狂暴重叠，且上一公共冷却为终结技",
    },
  }),
  rule({
    id: "default.apex_bite",
    actionId: "ferociousBite",
    list: "default",
    line: 27,
    simcAction: "ferocious_bite",
    sourceCondition: "buff.apex_predators_craving.up",
    fidelity: "exact",
    targetSelector: target.active,
    when: value("aura_up", { auraId: "apexPredatorsCraving" }),
    reason: "顶级捕食者触发：立即使用免费满星凶猛撕咬",
  }),
  rule({
    id: "finisher.rip",
    actionId: "rip",
    list: "finisher",
    line: 57,
    simcAction: "rip",
    sourceCondition: "combo_points>=5&refreshable&(buff.tigers_fury.up|remains<cooldown.tigers_fury.remains)",
    fidelity: "subset",
    targetSelector: target.first,
    when: and(
      compare("eq", targetCount, 1),
      compare("gte", comboPoints, 5),
      value("dot_refreshable", { dotId: "rip", target: "$selected" }),
      or(
        tigersFuryUp,
        compare(
          "lt",
          value("dot_remaining", { dotId: "rip", target: "$selected" }),
          value("cooldown_remaining", { actionId: "tigersFury" }),
        ),
      ),
    ),
    reason: "5 连击点且割裂进入可刷新窗口",
  }),
  rule({
    id: "finisher.bite",
    actionId: "ferociousBite",
    list: "finisher",
    line: 59,
    simcAction: "ferocious_bite",
    sourceCondition: "combo_points>=5",
    fidelity: "subset",
    targetSelector: target.minimumRip,
    when: and(
      compare("gte", comboPoints, 5),
      or(
        compare("eq", targetCount, 1),
        and(
          compare("eq", value("refreshable_dot_count", { dotId: "rip" }), 0),
          or(
            not(value("action_available", { actionId: "primalWrath" })),
            value("talent_selected", { token: "rampant_ferocity" }),
            and(
              compare("lt", targetCount, 5),
              value("dot_up", { dotId: "bloodseekerVines", target: "$selected" }),
            ),
          ),
        ),
      ),
    ),
    reason: {
      cases: [{
        when: and(
          compare("gt", targetCount, 1),
          value("dot_up", { dotId: "bloodseekerVines", target: "$selected" }),
        ),
        text: "目标存在血棘藤蔓且目标数低于 5，使用凶猛撕咬",
      }],
      fallback: "核心流血无需刷新，使用凶猛撕咬",
    },
  }),
  rule({
    id: "aoe.primal_wrath",
    actionId: "primalWrath",
    list: "aoe_finisher",
    line: 50,
    simcAction: "primal_wrath",
    sourceCondition: "combo_points>=5",
    fidelity: "subset",
    targetSelector: target.active,
    when: and(compare("gt", targetCount, 1), compare("gte", comboPoints, 5)),
    reason: "多目标 5 连击点，使用原始之怒维护群体割裂",
  }),
  rule({
    id: "aoe.rip",
    actionId: "rip",
    list: "aoe_finisher",
    line: 52,
    simcAction: "rip",
    sourceCondition: "combo_points>=5&!talent.primal_wrath&refreshable",
    targetIf: "min:remains",
    fidelity: "subset",
    targetSelector: target.refreshableRip,
    when: and(compare("gt", targetCount, 1), compare("gte", comboPoints, 5)),
    reason: "为可刷新目标维护独立割裂",
  }),
  rule({
    id: "aoe.rake",
    actionId: "rake",
    list: "aoe_builder",
    line: 34,
    simcAction: "rake",
    sourceCondition: "(talent.doubleclawed_rake&(!talent.lunar_inspiration|!talent.panthers_guile|active_dot.rake<5))|hero_tree.wildstalker&(active_dot.rake<2+!talent.panthers_guile+talent.lunar_inspiration)",
    targetIf: "refreshable",
    fidelity: "simplified-target-if",
    targetSelector: target.refreshableRake,
    when: and(
      compare("gt", targetCount, 1),
      compare(
        "lt",
        value("non_refreshable_dot_count", { dotId: "rake" }),
        minimum(targetCount, choose(value("talent_selected", { token: "panthers_guile" }), 2, 3)),
      ),
    ),
    reason: "保持当前构筑要求的有效斜掠覆盖",
  }),
  rule({
    id: "aoe.moonfire",
    actionId: "moonfire",
    list: "aoe_builder",
    line: 35,
    simcAction: "moonfire_cat",
    targetIf: "refreshable",
    fidelity: "subset",
    targetSelector: target.refreshableMoonfire,
    when: compare("gt", targetCount, 1),
    reason: "选择进入刷新窗口的目标补月火",
  }),
  rule({
    id: "aoe.swipe",
    actionId: "swipe",
    list: "aoe_builder",
    line: 41,
    simcAction: "swipe_cat",
    sourceCondition: "combo_points>1|spell_targets>2|!talent.panthers_guile",
    fidelity: "subset",
    targetSelector: target.active,
    when: compare("gt", targetCount, 1),
    reason: "多目标持续伤害均安全，使用横扫建造",
  }),
  rule({
    id: "builder.rake",
    actionId: "rake",
    list: "builder",
    line: 46,
    simcAction: "rake",
    sourceCondition: "(buff.tigers_fury.up|remains<cooldown.tigers_fury.remains)&(refreshable&persistent_multiplier>=pmultiplier|remains<2|persistent_multiplier>pmultiplier)",
    fidelity: "simplified-snapshot",
    targetSelector: target.first,
    when: and(
      compare("eq", targetCount, 1),
      value("dot_refreshable", { dotId: "rake", target: "$selected" }),
    ),
    reason: "斜掠缺失或进入 Pandemic 刷新窗口",
  }),
  rule({
    id: "builder.moonfire",
    actionId: "moonfire",
    list: "builder",
    line: 47,
    simcAction: "moonfire_cat",
    sourceCondition: "(buff.tigers_fury.up|remains<cooldown.tigers_fury.remains)&(refreshable&persistent_multiplier>=pmultiplier|remains<2|persistent_multiplier>pmultiplier)",
    fidelity: "simplified-snapshot",
    targetSelector: target.first,
    when: and(
      compare("eq", targetCount, 1),
      value("dot_refreshable", { dotId: "moonfire", target: "$selected" }),
    ),
    reason: "月火缺失或进入 Pandemic 刷新窗口",
  }),
  rule({
    id: "builder.shred",
    actionId: "shred",
    list: "builder",
    line: 48,
    simcAction: "shred",
    fidelity: "exact-fallback",
    targetSelector: target.first,
    when: compare("eq", targetCount, 1),
    reason: "核心持续伤害安全，使用撕碎建造",
  }),
]);
