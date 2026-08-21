const wowIcon = (fileDataId, spellId) => Object.freeze({
  fileDataId,
  spellId,
  path: `./assets/icons/${fileDataId}.jpg`,
  source: "Blizzard item/spell icon + render.worldofwarcraft.com",
});

const wowNamedIcon = (iconName, spellId) => Object.freeze({
  iconName,
  spellId,
  path: `./assets/icons/${iconName}.jpg`,
  source: "Blizzard spell icon + render.worldofwarcraft.com",
});

const itemVariant = (itemId, variantKey) => ({
  all: [{ itemId }, { itemVariantKey: variantKey }],
});

const PUZZLE_BOX_VARIANT = "item:193701|ilevel:289|bonus:|gems:|enchant:none|crafted:";
const ALNSEER_VARIANT = "item:249343|ilevel:289|bonus:|gems:|enchant:none|crafted:";
const ARCANOWEAVE_VARIANT =
  "item:244576|ilevel:285|bonus:1808/8790/8960/12214/12214/12214/12214/12214/12214/12214/12214/12384|gems:240892|enchant:none|crafted:32/49";
const LOA_BAND_VARIANT =
  "item:251513|ilevel:285|bonus:8960/8960/9627/12066/12214/12214|gems:240892|enchant:7967|crafted:";
const RENDOREI_WEAPON_VARIANT =
  "item:251077|ilevel:289|bonus:|gems:|enchant:8039|crafted:";
const FOREST_HUNTER_LEGS_VARIANT =
  "item:250023|ilevel:289|bonus:13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575/13575|gems:|enchant:8159|crafted:";

const rppmAuraTriggers = ({ stateKey, rppm, auraId, durationMs }) =>
  ["on_action_result", "on_dot_tick", "on_auto_attack"].map((hook) => ({
    hook,
    proc: {
      kind: "rppm",
      rppm,
      badLuckProtection: true,
      stateKey,
    },
    operations: [{
      kind: "aura_refresh",
      auraId,
      durationMs,
      maxStacks: 1,
    }],
  }));

export const ITEM_ACTION_CATALOG = Object.freeze([
  {
    id: "algetharPuzzleBox",
    spellId: 383781,
    itemId: 193701,
    icon: wowIcon(133876, 383781),
    simcName: "use_item_algethar_puzzle_box",
    name: "阿尔盖萨谜盒",
    shortName: "谜",
    defaultCode: null,
    kind: "item",
    trackingGroup: "item-cooldown",
    color: "amber",
    requirements: itemVariant(193701, PUZZLE_BOX_VARIANT),
    cooldownMs: 120000,
    cooldownGroup: "onUseTrinket",
    cooldownGroupMs: 20000,
    offGcd: true,
    channel: {
      durationMs: 2000,
      tickMs: 2000,
      tickCount: 1,
      hasteAffected: true,
    },
    resultModel: { enabled: false },
    source: {
      kind: "simc-12.1-local-snapshot",
      itemId: 193701,
      spellId: 383781,
      sourceRef: "unique_gear_dragonflight.cpp:3065-3240; SpellData 383781",
    },
  },
]);

// Keep the essence generator before the driver: the event that first grants
// Alnsight must not also grant an essence stack.
export const ITEM_EFFECT_CATALOG = Object.freeze([
  {
    id: "item244576ArcanoweaveInsight",
    name: "奥术织线：奥术织线洞察",
    mechanism: "rppm+aura_refresh",
    requirements: itemVariant(244576, ARCANOWEAVE_VARIANT),
    aura: {
      id: "arcanoweaveInsight",
      name: "奥术织线洞察",
      spellId: 1229746,
      icon: wowNamedIcon("inv_elemental_primal_mana", 1229746),
      durationMs: 20000,
      maxStacks: 1,
      statModifiers: { agility: 43 },
      shortName: "织",
      color: "arcane",
    },
    triggers: rppmAuraTriggers({
      stateKey: "item244576-arcanoweave-rppm",
      rppm: 2,
      auraId: "arcanoweaveInsight",
      durationMs: 20000,
    }),
    source: {
      kind: "simc-12.1-local-snapshot",
      itemId: 244576,
      spellIds: [1229511, 1229746],
      sourceRef: "unique_gear_midnight.cpp:604-650; MID1 ilvl 285 SimC debug value=43 agility",
    },
  },
  {
    id: "enchant8039AcuityOfTheRendorei",
    name: "伦德雷敏锐：虚空之力",
    mechanism: "rppm+aura_refresh",
    requirements: {
      all: [{ enchantId: 8039 }, { itemVariantKey: RENDOREI_WEAPON_VARIANT }],
    },
    aura: {
      id: "mightOfTheVoid",
      name: "虚空之力",
      spellId: 1241715,
      icon: wowNamedIcon("ui_profession_enchanting", 1241715),
      durationMs: 15000,
      maxStacks: 1,
      statModifiers: { agility: 66 },
      shortName: "虚",
      color: "violet",
    },
    triggers: rppmAuraTriggers({
      stateKey: "enchant8039-acuity-rppm",
      rppm: 3,
      auraId: "mightOfTheVoid",
      durationMs: 15000,
    }),
    source: {
      kind: "simc-12.1-local-snapshot",
      enchantId: 8039,
      spellIds: [1241710, 1241715],
      sourceRef: "unique_gear_midnight.cpp:550-568,5413-5418; MID1 ilvl 289 SimC debug value=66 agility",
    },
  },
  {
    id: "item251513LoaWorshipersBand",
    name: "神灵崇拜者指环",
    mechanism: "rppm+random_choice+aura_refresh",
    requirements: itemVariant(251513, LOA_BAND_VARIANT),
    auras: [
      {
        id: "blessingOfTheCapybara",
        name: "水豚的祝福",
        spellId: 1252524,
        icon: wowNamedIcon("inv_capybara_orange", 1252524),
        durationMs: 15000,
        maxStacks: 1,
        statModifiers: { agility: 54 },
        shortName: "豚",
        color: "amber",
      },
      {
        id: "akilzonsCryOfVictory",
        name: "埃基尔松的胜利鸣叫",
        spellId: 1252818,
        icon: wowNamedIcon("artifactability_survivalhunter_eaglesbite", 1252818),
        durationMs: 15000,
        maxStacks: 1,
        statModifiers: { hasteRating: 111 },
        shortName: "鹰",
        color: "gold",
      },
    ],
    triggers: ["on_action_result", "on_dot_tick", "on_auto_attack"].map((hook) => ({
      hook,
      proc: {
        kind: "rppm",
        rppm: 2,
        badLuckProtection: true,
        stateKey: "item251513-loa-rppm",
      },
      operations: [{
        kind: "random_choice",
        choices: [
          {
            weight: 1,
            label: "capybara",
            operations: [{
              kind: "aura_refresh",
              auraId: "blessingOfTheCapybara",
              durationMs: 15000,
              maxStacks: 1,
            }],
          },
          {
            weight: 1,
            label: "akilzon",
            operations: [{
              kind: "aura_refresh",
              auraId: "akilzonsCryOfVictory",
              durationMs: 15000,
              maxStacks: 1,
            }],
          },
        ],
      }],
    })),
    source: {
      kind: "simc-12.1-local-snapshot",
      itemId: 251513,
      spellIds: [1251904, 1252524, 1252818],
      sourceRef: "unique_gear_midnight.cpp:921-1045; MID1 Peridot pool=Capybara/Akil'zon; values=54 agility/111 haste",
    },
  },
  {
    id: "enchant7967EyesOfTheEagle",
    name: "鹰眼",
    mechanism: "combat_stat_modifier",
    requirements: { enchantId: 7967 },
    resolution: {
      kind: "combat_stat_multiplier",
      stat: "criticalDamageMultiplier",
      multiplierPerEquippedEnchant: 1.02,
      enchantId: 7967,
    },
    source: {
      kind: "simc-12.1-local-snapshot",
      enchantId: 7967,
      spellId: 1236701,
      sourceRef: "SpellData 1236701; two equipped copies => 1.02^2=1.0404 critical damage multiplier",
    },
  },
  {
    id: "item249343EssenceGenerator",
    name: "艾恩先知的凝视：艾恩蔑视精华",
    mechanism: "internal_cooldown+aura_stack",
    requirements: itemVariant(249343, ALNSEER_VARIANT),
    aura: {
      id: "alnscornedEssence",
      name: "艾恩蔑视精华",
      spellId: 1266687,
      icon: wowIcon(7636702, 1266687),
      durationMs: 12000,
      maxStacks: 20,
      stackingMode: "independent",
      statModifiers: { agility: 27 },
      shortName: "精",
      color: "teal",
    },
    triggers: [
      {
        hook: "on_action_result",
        when: { auraUp: "alnsight" },
        internalCooldownMs: 750,
        internalCooldownKey: "item249343-essence",
        operations: [{
          kind: "aura_stack",
          auraId: "alnscornedEssence",
          durationMs: 12000,
          stacks: 1,
          maxStacks: 20,
          stackingMode: "independent",
        }],
      },
      {
        hook: "on_dot_tick",
        when: { auraUp: "alnsight" },
        internalCooldownMs: 750,
        internalCooldownKey: "item249343-essence",
        operations: [{
          kind: "aura_stack",
          auraId: "alnscornedEssence",
          durationMs: 12000,
          stacks: 1,
          maxStacks: 20,
          stackingMode: "independent",
        }],
      },
      {
        hook: "on_auto_attack",
        when: { auraUp: "alnsight" },
        internalCooldownMs: 750,
        internalCooldownKey: "item249343-essence",
        operations: [{
          kind: "aura_stack",
          auraId: "alnscornedEssence",
          durationMs: 12000,
          stacks: 1,
          maxStacks: 20,
          stackingMode: "independent",
        }],
      },
    ],
    source: {
      kind: "simc-12.1-local-snapshot",
      itemId: 249343,
      spellIds: [1266686, 1266687],
      sourceRef: "unique_gear_midnight.cpp:1938-2024; SpellData 1266686/1266687",
    },
  },
  {
    id: "item249343AlnsightDriver",
    name: "艾恩先知的凝视：艾恩洞察",
    mechanism: "rppm+aura_refresh",
    requirements: itemVariant(249343, ALNSEER_VARIANT),
    aura: {
      id: "alnsight",
      name: "艾恩洞察",
      spellId: 1266686,
      icon: wowIcon(7636702, 1266686),
      durationMs: 12000,
      maxStacks: 1,
      shortName: "洞",
      color: "violet",
    },
    triggers: ["on_action_result", "on_dot_tick", "on_auto_attack"].map((hook) => ({
      hook,
      proc: {
        kind: "rppm",
        rppm: 2,
        badLuckProtection: true,
        stateKey: "item249343-alnsight-rppm",
      },
      operations: [{
        kind: "aura_refresh",
        auraId: "alnsight",
        durationMs: 12000,
        maxStacks: 1,
      }],
    })),
    source: {
      kind: "simc-12.1-local-snapshot",
      itemId: 249343,
      spellIds: [1256896, 1266686],
      sourceRef: "unique_gear_midnight.cpp:1938-2024; SpellData 1256896",
    },
  },
  {
    id: "item193701PuzzleMastery",
    name: "阿尔盖萨谜盒：解谜完成",
    mechanism: "on_channel_complete+aura_refresh",
    requirements: itemVariant(193701, PUZZLE_BOX_VARIANT),
    aura: {
      id: "algetharPuzzleMastery",
      name: "阿尔盖萨谜盒",
      spellId: 383781,
      icon: wowIcon(133876, 383781),
      durationMs: 20000,
      maxStacks: 1,
      statModifiers: { masteryRating: 861 },
      shortName: "谜",
      color: "amber",
    },
    triggers: [{
      hook: "on_channel_complete",
      when: { actionIds: ["algetharPuzzleBox"] },
      operations: [{
        kind: "aura_refresh",
        auraId: "algetharPuzzleMastery",
        durationMs: 20000,
        maxStacks: 1,
      }],
    }],
    source: {
      kind: "simc-12.1-local-snapshot",
      itemId: 193701,
      spellId: 383781,
      sourceRef: "unique_gear_dragonflight.cpp:3065-3240; MID1 ilvl 289 SimC debug value=861 mastery",
    },
  },
]);

export const EQUIPMENT_EFFECT_IMPLEMENTATIONS = Object.freeze([
  {
    sourceKind: "item",
    sourceId: 244576,
    name: "银月特工护腕（奥术织线）",
    variants: [ARCANOWEAVE_VARIANT],
    effectIds: ["item244576ArcanoweaveInsight"],
    status: "supported",
  },
  {
    sourceKind: "item",
    sourceId: 251513,
    name: "神灵崇拜者指环",
    variants: [LOA_BAND_VARIANT],
    effectIds: ["item251513LoaWorshipersBand"],
    status: "supported",
  },
  {
    sourceKind: "item",
    sourceId: 193701,
    name: "阿尔盖萨谜盒",
    variants: [PUZZLE_BOX_VARIANT],
    actionIds: ["algetharPuzzleBox"],
    effectIds: ["item193701PuzzleMastery"],
    status: "supported",
  },
  {
    sourceKind: "item",
    sourceId: 249343,
    name: "艾恩先知的凝视",
    variants: [ALNSEER_VARIANT],
    effectIds: ["item249343EssenceGenerator", "item249343AlnsightDriver"],
    status: "partially-supported",
    unsupportedEffects: [{
      id: "item:249343:alnsight-refresh-icd-bug",
      mechanism: "simc_custom_refresh_icd_bug",
      reason: "SimC 会在艾恩洞察于精华 750ms ICD 期间刷新时，让下一次精华触发绕过 ICD；基础 RPPM、洞察、ICD 和独立层数已支持，该已知游戏异常尚未复刻。",
      impact: "edge-case-proc-timing",
      evidenceRefs: ["unique_gear_midnight.cpp:1964-2016"],
    }],
  },
  {
    sourceKind: "enchant",
    sourceId: 8039,
    name: "伦德雷敏锐",
    variants: [RENDOREI_WEAPON_VARIANT],
    effectIds: ["enchant8039AcuityOfTheRendorei"],
    status: "supported",
  },
  {
    sourceKind: "enchant",
    sourceId: 7967,
    name: "鹰眼",
    effectIds: ["enchant7967EyesOfTheEagle"],
    status: "supported",
  },
  {
    sourceKind: "enchant",
    sourceId: 8159,
    name: "森林猎手护甲片",
    variants: [FOREST_HUNTER_LEGS_VARIANT],
    status: "supported",
  },
  ...[
    [7987, "世界之魂印记", "吸血属性不改变当前木桩资源、技能可用性或 APL，待伤害/生存模型阶段接入。"],
    [7993, "鞋部附魔", "移动速度与耐力不改变静止木桩技能循环，当前明确排除。"],
    [8001, "肩部附魔", "闪避属性不改变当前木桩资源、技能可用性或 APL，待防御模型阶段接入。"],
    [8017, "头部附魔", "闪避及防御触发不改变当前木桩输出循环，待防御模型阶段接入。"],
  ].map(([sourceId, name, reason]) => ({
    sourceKind: "enchant",
    sourceId,
    name,
    status: "out-of-scope",
    unsupportedEffects: [{
      id: `enchant:${sourceId}:out-of-scope`,
      mechanism: "out_of_scope_defensive_or_movement_stat",
      reason,
      impact: "out-of-scope",
      evidenceRefs: ["SpellItemEnchantment 12.1.0.69299; MID1 SimC stat snapshot"],
    }],
  })),
]);

export const EQUIPMENT_STATIC_MODIFIER_CATALOG = Object.freeze([
  {
    sourceKind: "gem",
    sourceId: 240892,
    name: "无瑕精湛橄榄石",
    stats: { haste_rating: 16, mastery_rating: 7 },
    sourceRef: "MID1 SimC gear snapshot; item 240892",
  },
  {
    sourceKind: "gem",
    sourceId: 240983,
    name: "头部主属性宝石",
    stats: { agility: 32 },
    sourceRef: "MID1 SimC gear snapshot; item 240983",
  },
  {
    sourceKind: "enchant",
    sourceId: 8159,
    name: "森林猎手护甲片",
    variants: [FOREST_HUNTER_LEGS_VARIANT],
    stats: { agility: 91 },
    sourceRef: "MID1 SimC gear snapshot; enchant 8159 agility component",
  },
]);

export const ITEM_EFFECT_VARIANTS = Object.freeze({
  puzzleBox: PUZZLE_BOX_VARIANT,
  gazeOfTheAlnseer: ALNSEER_VARIANT,
  arcanoweaveLining: ARCANOWEAVE_VARIANT,
  loaWorshipersBand: LOA_BAND_VARIANT,
  acuityOfTheRendorei: RENDOREI_WEAPON_VARIANT,
  forestHunterLegs: FOREST_HUNTER_LEGS_VARIANT,
});
