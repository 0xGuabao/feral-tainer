import { DRUID_TALENT_TREE_12_1 } from "../generated/druid-talent-tree.generated.js";
import {
  ACTION_CATALOG,
  APL_CATALOG,
  CUSTOM_HANDLER_DECLARATIONS,
  EFFECT_CATALOG,
  FERAL_VERSION,
  INTERNAL_ACTION_CATALOG,
  SET_BONUS_CATALOG,
  TALENT_EFFECT_COVERAGE,
} from "./feral-game-data.js";
import {
  EQUIPMENT_EFFECT_IMPLEMENTATIONS,
  EQUIPMENT_STATIC_MODIFIER_CATALOG,
  ITEM_ACTION_CATALOG,
  ITEM_EFFECT_CATALOG,
} from "./feral-item-effect-data.js";

const VERIFIED_BY = Object.freeze({
  setBonus: ["demo/tests/simc-data-pipeline.test.mjs", "demo/tests/architecture.test.mjs"],
  action: ["demo/tests/architecture.test.mjs", "demo/tests/stat-and-result-runtime.test.mjs"],
  internalAction: ["demo/tests/architecture.test.mjs"],
  effect: ["demo/tests/architecture.test.mjs", "demo/tests/stat-and-result-runtime.test.mjs"],
  talentCoverage: ["demo/tests/architecture.test.mjs", "demo/tests/catalog-layering.test.mjs"],
  apl: ["demo/tests/architecture.test.mjs"],
  customHandler: ["demo/tests/architecture.test.mjs"],
  itemAction: ["demo/tests/item-effect-runtime.test.mjs"],
  itemEffect: ["demo/tests/item-effect-runtime.test.mjs"],
  equipmentImplementation: ["demo/tests/item-effect-runtime.test.mjs", "demo/tests/resolved-profile-v2.test.mjs"],
  equipmentStaticModifier: ["demo/tests/stat-and-result-runtime.test.mjs", "demo/tests/resolved-profile-v2.test.mjs"],
});

const CATALOG_DEFAULT_SOURCES = Object.freeze({
  setBonus: ["vendor/simc/engine/dbc/generated/item_set_bonus.inc"],
  action: [
    "vendor/simc/engine/class_modules/sc_druid.cpp",
    "vendor/simc/engine/class_modules/apl/druid/feral_apl.inc",
    "vendor/simc/SpellDataDump/druid.txt",
  ],
  internalAction: [
    "vendor/simc/engine/class_modules/sc_druid.cpp",
    "vendor/simc/SpellDataDump/druid.txt",
  ],
  effect: [
    "vendor/simc/engine/class_modules/sc_druid.cpp",
    "vendor/simc/SpellDataDump/druid.txt",
  ],
  talentCoverage: [
    "vendor/simc/engine/dbc/generated/trait_data.inc",
    "vendor/simc/SpellDataDump/druid.txt",
  ],
  apl: ["vendor/simc/engine/class_modules/apl/druid/feral_apl.inc"],
  customHandler: ["vendor/simc/engine/class_modules/sc_druid.cpp"],
  itemAction: ["vendor/simc/engine/player/unique_gear_dragonflight.cpp"],
  itemEffect: ["vendor/simc/engine/player/unique_gear_midnight.cpp"],
  equipmentImplementation: [
    "vendor/simc/engine/player/unique_gear_midnight.cpp",
    "validation/oracles/simc-profile-manifest.json",
  ],
  equipmentStaticModifier: ["validation/oracles/simc-profile-manifest.json"],
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function talentToken(name) {
  return name
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

const TALENT_ENTRY_BY_TOKEN = new Map(
  DRUID_TALENT_TREE_12_1.nodes
    .flatMap((node) => node.entries)
    .map((entry) => [talentToken(entry.name), entry]),
);

function collectSourceRefs(value, refs = new Set()) {
  if (!value || typeof value !== "object") return refs;
  for (const [key, nested] of Object.entries(value)) {
    if (["sourceRef", "sourceRefs", "evidenceRefs"].includes(key)) {
      const values = Array.isArray(nested) ? nested : [nested];
      for (const candidate of values) {
        if (typeof candidate === "string" && candidate.trim()) refs.add(candidate.trim());
      }
      continue;
    }
    collectSourceRefs(nested, refs);
  }
  return refs;
}

function collectRequirements(value, result = { talents: new Set(), setBonuses: new Set() }) {
  if (!value || typeof value !== "object") return result;
  if (typeof value.talent === "string") result.talents.add(value.talent);
  if (typeof value.setBonus === "string") result.setBonuses.add(value.setBonus);
  for (const nested of Object.values(value)) collectRequirements(nested, result);
  return result;
}

function collectNumericIds(value, result = { spellIds: new Set(), itemIds: new Set(), enchantIds: new Set() }) {
  if (!value || typeof value !== "object") return result;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "spellId" && Number.isInteger(nested)) result.spellIds.add(nested);
    if (key === "spellIds" && Array.isArray(nested)) {
      for (const candidate of nested) if (Number.isInteger(candidate)) result.spellIds.add(candidate);
    }
    if (key === "itemId" && Number.isInteger(nested)) result.itemIds.add(nested);
    if (key === "enchantId" && Number.isInteger(nested)) result.enchantIds.add(nested);
    collectNumericIds(nested, result);
  }
  return result;
}

function talentIdentifiers(tokens) {
  return [...tokens].sort().map((token) => {
    const entry = TALENT_ENTRY_BY_TOKEN.get(token);
    return entry
      ? {
          token,
          nodeId: entry.nodeId,
          entryId: entry.entryId,
          definitionId: entry.definitionId,
          spellId: entry.spellId,
        }
      : { token, unresolved: true };
  });
}

function makeRule({ catalog, id, entry, linked = [], extraTalents = [], extraSetBonuses = [], sourceRefs = [] }) {
  const evidenceValues = [entry, ...linked];
  const explicitSourceRefs = new Set(sourceRefs);
  const requirements = { talents: new Set(extraTalents), setBonuses: new Set(extraSetBonuses) };
  const numericIds = { spellIds: new Set(), itemIds: new Set(), enchantIds: new Set() };

  for (const value of evidenceValues) {
    collectSourceRefs(value, explicitSourceRefs);
    collectRequirements(value, requirements);
    collectNumericIds(value, numericIds);
  }

  if (entry?.sourceKind === "item" && Number.isInteger(entry.sourceId)) numericIds.itemIds.add(entry.sourceId);
  if (entry?.sourceKind === "gem" && Number.isInteger(entry.sourceId)) numericIds.itemIds.add(entry.sourceId);
  if (entry?.sourceKind === "enchant" && Number.isInteger(entry.sourceId)) numericIds.enchantIds.add(entry.sourceId);

  const precision = explicitSourceRefs.size > 0 ? "explicit" : "catalog-default";
  const resolvedSourceRefs = precision === "explicit"
    ? [...explicitSourceRefs]
    : CATALOG_DEFAULT_SOURCES[catalog];

  return deepFreeze({
    ruleId: `${catalog}:${id}`,
    catalog,
    catalogId: String(id),
    sourceVersion: {
      gameVersion: FERAL_VERSION.gameVersion,
      simcVersion: FERAL_VERSION.simcVersion,
      simcCommit: FERAL_VERSION.simcCommit,
      vendorFingerprint: FERAL_VERSION.vendorFingerprint,
    },
    evidencePrecision: precision,
    sourceRefs: [...resolvedSourceRefs].sort(),
    identifiers: {
      spellIds: [...numericIds.spellIds].sort((left, right) => left - right),
      itemIds: [...numericIds.itemIds].sort((left, right) => left - right),
      enchantIds: [...numericIds.enchantIds].sort((left, right) => left - right),
      setBonusIds: [...requirements.setBonuses].sort(),
      talents: talentIdentifiers(requirements.talents),
    },
    verifiedBy: VERIFIED_BY[catalog],
  });
}

const ACTION_BY_ID = new Map(ACTION_CATALOG.map((entry) => [entry.id, entry]));
const INTERNAL_ACTION_BY_ID = new Map(INTERNAL_ACTION_CATALOG.map((entry) => [entry.id, entry]));
const EFFECT_BY_ID = new Map(EFFECT_CATALOG.map((entry) => [entry.id, entry]));
const ITEM_ACTION_BY_ID = new Map(ITEM_ACTION_CATALOG.map((entry) => [entry.id, entry]));
const ITEM_EFFECT_BY_ID = new Map(ITEM_EFFECT_CATALOG.map((entry) => [entry.id, entry]));

const linkedEntries = (ids, index) => (ids ?? []).map((id) => index.get(id)).filter(Boolean);

const records = [
  ...SET_BONUS_CATALOG.map((entry) => makeRule({ catalog: "setBonus", id: entry.id, entry })),
  ...ACTION_CATALOG.map((entry) => makeRule({ catalog: "action", id: entry.id, entry })),
  ...INTERNAL_ACTION_CATALOG.map((entry) => makeRule({ catalog: "internalAction", id: entry.id, entry })),
  ...EFFECT_CATALOG.map((entry) => makeRule({ catalog: "effect", id: entry.id, entry })),
  ...Object.entries(TALENT_EFFECT_COVERAGE).map(([token, entry]) => makeRule({
    catalog: "talentCoverage",
    id: token,
    entry,
    extraTalents: [token],
    linked: [
      ...linkedEntries(entry.actionIds, ACTION_BY_ID),
      ...linkedEntries(entry.internalActionIds, INTERNAL_ACTION_BY_ID),
      ...linkedEntries(entry.effectIds, EFFECT_BY_ID),
    ],
  })),
  ...APL_CATALOG.map((entry) => makeRule({
    catalog: "apl",
    id: entry.id,
    entry,
    linked: linkedEntries([entry.actionId], ACTION_BY_ID),
    sourceRefs: [`vendor/simc/engine/class_modules/apl/druid/feral_apl.inc:${entry.line}`],
  })),
  ...CUSTOM_HANDLER_DECLARATIONS.map((entry) => makeRule({
    catalog: "customHandler",
    id: entry.id,
    entry,
    linked: EFFECT_CATALOG.filter((effect) => JSON.stringify(effect).includes(`\"handlerId\":\"${entry.id}\"`)),
  })),
  ...ITEM_ACTION_CATALOG.map((entry) => makeRule({ catalog: "itemAction", id: entry.id, entry })),
  ...ITEM_EFFECT_CATALOG.map((entry) => makeRule({ catalog: "itemEffect", id: entry.id, entry })),
  ...EQUIPMENT_EFFECT_IMPLEMENTATIONS.map((entry) => makeRule({
    catalog: "equipmentImplementation",
    id: `${entry.sourceKind}:${entry.sourceId}`,
    entry,
    linked: [
      ...linkedEntries(entry.actionIds, ITEM_ACTION_BY_ID),
      ...linkedEntries(entry.effectIds, ITEM_EFFECT_BY_ID),
    ],
  })),
  ...EQUIPMENT_STATIC_MODIFIER_CATALOG.map((entry) => makeRule({
    catalog: "equipmentStaticModifier",
    id: `${entry.sourceKind}:${entry.sourceId}`,
    entry,
  })),
];

export const FERAL_SEMANTIC_PROVENANCE = deepFreeze({
  schemaVersion: 1,
  sourceVersion: {
    gameVersion: FERAL_VERSION.gameVersion,
    simcVersion: FERAL_VERSION.simcVersion,
    simcCommit: FERAL_VERSION.simcCommit,
    vendorFingerprint: FERAL_VERSION.vendorFingerprint,
  },
  evidencePrecisionDefinitions: {
    explicit: "The authored entry or a directly linked entry carries a concrete source/evidence reference.",
    "catalog-default": "Only the catalog-level authoritative source is known; no fabricated line-level precision is claimed.",
  },
  records,
});
