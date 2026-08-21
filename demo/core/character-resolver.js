import { deepFreeze } from "./contracts.js";
import { getLastProfileValue, getProfileAssignments } from "./simc-profile-parser.js";

const CHARACTER_FIELD_KEYS = Object.freeze(["level", "race", "role", "position", "source"]);

function positiveIntegerOrNull(value) {
  if (!/^\d+$/.test(value ?? "")) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveCharacter(input, version) {
  const profile = input.simcProfile;
  const consumedFieldIds = [];
  if (profile) {
    for (const key of CHARACTER_FIELD_KEYS.filter((entry) => entry !== "level")) {
      for (const assignment of getProfileAssignments(profile, key)) {
        consumedFieldIds.push(`line:${assignment.lineNumber}:${assignment.key}`);
      }
    }
  }
  const rawLevel = profile ? getLastProfileValue(profile, "level") : null;
  const parsedLevel = positiveIntegerOrNull(rawLevel);
  if (profile && parsedLevel != null) {
    for (const assignment of getProfileAssignments(profile, "level")) {
      consumedFieldIds.push(`line:${assignment.lineNumber}:${assignment.key}`);
    }
  }

  return deepFreeze({
    character: {
      name: profile ? getLastProfileValue(profile, "druid") ?? input.label : input.label,
      class: { id: 11, token: "druid", name: "德鲁伊" },
      level: parsedLevel ?? version.level,
      race: profile ? getLastProfileValue(profile, "race") ?? null : null,
      role: profile ? getLastProfileValue(profile, "role") ?? "attack" : "attack",
      position: profile ? getLastProfileValue(profile, "position") ?? "back" : "back",
      specialization: { ...version.specialization },
      profileSource: profile ? getLastProfileValue(profile, "source") ?? input.source : input.source,
    },
    consumedFieldIds,
  });
}
