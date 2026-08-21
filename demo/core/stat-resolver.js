import { deepFreeze } from "./contracts.js";
import { FERAL_STAT_DATA_12_1 } from "../data/12.1/feral-stat-data.js";

function round(value, digits = 12) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function applySecondaryRatingDiminishingReturns(rawPoints, statData = FERAL_STAT_DATA_12_1) {
  const value = Math.max(0, Number(rawPoints) || 0);
  const points = statData.diminishingReturns.points;
  if (value <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [rightInput, rightOutput] = points[index];
    const [leftInput, leftOutput] = points[index - 1];
    if (value > rightInput) continue;
    const progress = (value - leftInput) / (rightInput - leftInput);
    return leftOutput + (rightOutput - leftOutput) * progress;
  }
  return points.at(-1)[1];
}

function convertedRating(rating, ratingPerPoint, statData) {
  return applySecondaryRatingDiminishingReturns(
    Math.max(0, Number(rating) || 0) / ratingPerPoint,
    statData,
  );
}

export function resolveDynamicCombatStats(
  profile,
  statModifiers = {},
  statData = FERAL_STAT_DATA_12_1,
) {
  const base = profile.combatStats;
  const ratings = profile.baseStats?.ratings;
  const result = { ...base };
  const ratingComplete = ratings && Object.values(ratings).every(Number.isFinite);

  if (ratingComplete) {
    const baseCritFromRating = convertedRating(
      ratings.criticalStrike,
      statData.ratingPerPoint.criticalStrikePercent,
      statData,
    ) / 100;
    const talentCritOffset = Number(base.critChance ?? 0) -
      statData.feral.baseCritChance - baseCritFromRating;
    const currentCritFromRating = convertedRating(
      ratings.criticalStrike + Number(statModifiers.criticalStrikeRating ?? 0),
      statData.ratingPerPoint.criticalStrikePercent,
      statData,
    ) / 100;
    result.critChance = round(
      statData.feral.baseCritChance + talentCritOffset + currentCritFromRating +
      Number(statModifiers.critChance ?? 0),
    );

    const baseHasteFromRating = convertedRating(
      ratings.haste,
      statData.ratingPerPoint.hastePercent,
      statData,
    ) / 100;
    const hasteOffset = Number(base.hastePercent ?? 0) - baseHasteFromRating;
    const currentHasteFromRating = convertedRating(
      ratings.haste + Number(statModifiers.hasteRating ?? 0),
      statData.ratingPerPoint.hastePercent,
      statData,
    ) / 100;
    result.hastePercent = round(
      currentHasteFromRating + hasteOffset + Number(statModifiers.hastePercent ?? 0),
    );
    result.hasteMultiplier = round(1 + result.hastePercent);

    const baseMasteryFromRating = convertedRating(
      ratings.mastery,
      statData.ratingPerPoint.masteryPoint,
      statData,
    );
    const masteryOffset = Number(base.masteryPoints ?? statData.feral.baseMasteryPoints) -
      statData.feral.baseMasteryPoints - baseMasteryFromRating;
    const currentMasteryFromRating = convertedRating(
      ratings.mastery + Number(statModifiers.masteryRating ?? 0),
      statData.ratingPerPoint.masteryPoint,
      statData,
    );
    result.masteryPoints = round(
      statData.feral.baseMasteryPoints + masteryOffset + currentMasteryFromRating +
      Number(statModifiers.masteryPoints ?? 0),
    );
    result.masteryValue = round(
      result.masteryPoints * statData.feral.masteryValuePerPoint +
      Number(statModifiers.masteryValue ?? 0),
    );

    const baseVersatilityFromRating = convertedRating(
      ratings.versatility,
      statData.ratingPerPoint.versatilityPercent,
      statData,
    ) / 100;
    const versatilityOffset = Number(base.versatilityPercent ?? 0) - baseVersatilityFromRating;
    const currentVersatilityFromRating = convertedRating(
      ratings.versatility + Number(statModifiers.versatilityRating ?? 0),
      statData.ratingPerPoint.versatilityPercent,
      statData,
    ) / 100;
    result.versatilityPercent = round(
      currentVersatilityFromRating + versatilityOffset +
      Number(statModifiers.versatilityPercent ?? 0),
    );
  } else {
    result.critChance = round(Number(base.critChance ?? 0) + Number(statModifiers.critChance ?? 0));
    result.hastePercent = round(Number(base.hastePercent ?? 0) + Number(statModifiers.hastePercent ?? 0));
    result.hasteMultiplier = round(Number(base.hasteMultiplier ?? 1) + Number(statModifiers.hastePercent ?? 0));
    if (base.masteryPoints != null) {
      result.masteryPoints = round(Number(base.masteryPoints) + Number(statModifiers.masteryPoints ?? 0));
    }
    if (base.masteryValue != null) {
      result.masteryValue = round(Number(base.masteryValue) + Number(statModifiers.masteryValue ?? 0));
    }
    if (base.versatilityPercent != null) {
      result.versatilityPercent = round(
        Number(base.versatilityPercent) + Number(statModifiers.versatilityPercent ?? 0),
      );
    }
  }

  if (base.agility != null) {
    result.agility = round(Number(base.agility) + Number(statModifiers.agility ?? 0));
    result.attackPower = round(
      result.agility * statData.feral.attackPowerPerAgility +
      Number(statModifiers.attackPower ?? 0),
    );
  }
  result.dynamicStatModifiers = { ...statModifiers };
  result.source = Object.keys(statModifiers).length
    ? "resolved-profile+active-aura-modifiers"
    : base.source;
  return result;
}

function resolveCharacterBase(character, statData) {
  if (!character?.race) return null;
  const race = statData.raceBase[character.race];
  if (!race) return null;
  return {
    agility: statData.classBase.agility + race.agility,
    stamina: statData.classBase.stamina + race.stamina,
  };
}

export function createStatProfile({
  combatStats,
  baselineCombatStats = combatStats,
  character = null,
  equipment,
  statData = FERAL_STAT_DATA_12_1,
}) {
  const rawItemStats = {};
  for (const item of equipment.slots) {
    for (const [stat, value] of Object.entries(item.resolvedStats ?? {})) {
      rawItemStats[stat] = (rawItemStats[stat] ?? 0) + value;
    }
  }
  const staticModifierTotals = equipment.staticModifiers?.totals ?? {};
  const rawEquipmentStats = { ...rawItemStats };
  for (const [stat, value] of Object.entries(staticModifierTotals)) {
    rawEquipmentStats[stat] = (rawEquipmentStats[stat] ?? 0) + value;
  }
  const agility = ["agility", "agiint", "stragi", "stragiint"]
    .reduce((total, stat) => total + (rawEquipmentStats[stat] ?? 0), 0);
  const characterBase = resolveCharacterBase(character, statData);
  const staticEquipmentComplete = Boolean(
    equipment.statsComplete && equipment.staticModifiers?.complete !== false,
  );
  const staticPrimaryComplete = Boolean(staticEquipmentComplete && characterBase);
  const staticAgility = staticPrimaryComplete ? characterBase.agility + agility : null;
  const staticStamina = staticPrimaryComplete
    ? characterBase.stamina + (rawEquipmentStats.stamina ?? 0)
    : null;
  const ratings = {
    criticalStrike: staticEquipmentComplete ? rawEquipmentStats.crit_rating ?? 0 : null,
    haste: staticEquipmentComplete ? rawEquipmentStats.haste_rating ?? 0 : null,
    mastery: staticEquipmentComplete ? rawEquipmentStats.mastery_rating ?? 0 : null,
    versatility: staticEquipmentComplete ? rawEquipmentStats.versatility_rating ?? 0 : null,
  };
  const talentCritDelta = Number(combatStats.critChance ?? 0) - Number(baselineCombatStats.critChance ?? 0);
  const ratingConversionComplete = staticEquipmentComplete;
  const criticalStrikeFromRating = ratingConversionComplete
    ? applySecondaryRatingDiminishingReturns(
        ratings.criticalStrike / statData.ratingPerPoint.criticalStrikePercent,
        statData,
      ) / 100
    : null;
  const hasteFromRating = ratingConversionComplete
    ? applySecondaryRatingDiminishingReturns(
        ratings.haste / statData.ratingPerPoint.hastePercent,
        statData,
      ) / 100
    : null;
  const masteryFromRating = ratingConversionComplete
    ? applySecondaryRatingDiminishingReturns(
        ratings.mastery / statData.ratingPerPoint.masteryPoint,
        statData,
      )
    : null;
  const versatilityFromRating = ratingConversionComplete
    ? applySecondaryRatingDiminishingReturns(
        ratings.versatility / statData.ratingPerPoint.versatilityPercent,
        statData,
      ) / 100
    : null;
  const runtimeCombatStats = ratingConversionComplete
    ? {
        ...combatStats,
        critChance: round(statData.feral.baseCritChance + criticalStrikeFromRating + talentCritDelta),
        hastePercent: round(hasteFromRating),
        hasteMultiplier: round(1 + hasteFromRating),
        masteryPoints: round(statData.feral.baseMasteryPoints + masteryFromRating),
        masteryValue: round(
          (statData.feral.baseMasteryPoints + masteryFromRating) * statData.feral.masteryValuePerPoint,
        ),
        versatilityPercent: round(versatilityFromRating),
        agility: staticAgility,
        attackPower: staticAgility == null
          ? null
          : round(staticAgility * statData.feral.attackPowerPerAgility),
        source: "simc-static-stat-pipeline",
      }
    : {
        ...combatStats,
        hastePercent: Number(combatStats.hastePercent ?? 0),
        hasteMultiplier: Number(combatStats.hasteMultiplier ?? 1),
        masteryPoints: combatStats.masteryPoints ?? null,
        masteryValue: combatStats.masteryValue ?? null,
        versatilityPercent: combatStats.versatilityPercent ?? null,
        agility: combatStats.agility ?? null,
        attackPower: combatStats.attackPower ?? null,
      };
  return deepFreeze({
    baseStats: {
      schemaVersion: 1,
      complete: false,
      primary: {
        agility: staticAgility,
        stamina: staticStamina,
      },
      equipmentPrimary: {
        agility: staticEquipmentComplete ? agility : null,
        stamina: staticEquipmentComplete ? rawEquipmentStats.stamina ?? 0 : null,
      },
      characterBase,
      ratings,
      equipmentComplete: staticEquipmentComplete,
      staticPrimaryComplete,
      rawItemStats,
      staticModifierTotals,
      rawEquipmentStats,
      source: staticEquipmentComplete
        ? "simc-oracle-item-variants+equipment-modifier-catalog"
        : equipment.slots.length
          ? "equipment-parsed-stat-resolution-pending"
          : "no-equipment-profile-provided",
    },
    derivedStats: {
      schemaVersion: 1,
      complete: false,
      ratingConversionComplete,
      staticPrimaryComplete,
      criticalStrikeFromRating,
      hasteFromRating,
      masteryFromRating,
      versatilityFromRating,
      ...runtimeCombatStats,
    },
    combatStats: runtimeCombatStats,
  });
}
