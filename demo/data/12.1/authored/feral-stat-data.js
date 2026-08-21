import { SIMC_VERSION_LOCK } from "../generated/version.generated.js";

export const FERAL_STAT_DATA_12_1 = Object.freeze({
  schemaVersion: 1,
  gameVersion: SIMC_VERSION_LOCK.wowVersion,
  level: 90,
  classBase: {
    agility: 620,
    stamina: 4600,
  },
  raceBase: {
    night_elf: { agility: 2, stamina: 0 },
  },
  ratingPerPoint: {
    criticalStrikePercent: 46,
    hastePercent: 44,
    masteryPoint: 46,
    versatilityPercent: 54,
  },
  diminishingReturns: {
    curveId: 21024,
    points: [
      [0, 0],
      [30, 30],
      [40, 39],
      [50, 47],
      [60, 54],
      [80, 66],
      [100, 76],
      [200, 126],
    ],
  },
  feral: {
    baseCritChance: 0.1,
    baseMasteryPoints: 8,
    masteryValuePerPoint: 0.02,
    attackPowerPerAgility: 1,
  },
  sources: [
    "vendor/simc/engine/dbc/generated/sc_scale_data.inc: level-90 combat ratings",
    "vendor/simc/engine/player/rating.cpp: mastery rating is divided by 100",
    "vendor/simc/engine/dbc/generated/item_scaling.inc: curve 21024",
    "vendor/simc/engine/dbc/sc_extra_data.inc: Druid and Night Elf base attributes",
    "vendor/simc/engine/class_modules/sc_druid.cpp: attack_power_per_agility=1",
    "vendor/simc/engine/dbc/generated/sc_spell_data.inc: Razor Claws mastery coefficient",
  ],
});
