// Compatibility facade. New code should consume a ResolvedProfile from
// core/build-resolver.js instead of importing a fixed build from this module.
import { buildInputFromFixture } from "./core/build-input.js";
import { resolveFeralBuild } from "./core/build-resolver.js";
import { BUILD_FIXTURES, USER_VALIDATION_TALENT_CODE } from "./data/12.1/build-fixtures.js";
import {
  ACTION_CATALOG,
  APL_CATALOG,
  EFFECT_CATALOG,
  FERAL_VERSION,
} from "./data/12.1/feral-game-data.js";

export const FIXED_TALENT_CODE = USER_VALIDATION_TALENT_CODE;
export const PROFILE = resolveFeralBuild(buildInputFromFixture(BUILD_FIXTURES.userValidation));
export const ACTIONS = PROFILE.actions;
export const ACTION_BY_ID = PROFILE.actionById;
export const EFFECTS = PROFILE.effects;
export const EFFECT_BY_ID = Object.freeze(Object.fromEntries(EFFECTS.map((effect) => [effect.id, effect])));
export const APL_RULES = PROFILE.apl.rules;
export const SELECTED_TALENTS = PROFILE.build.talents;

export { ACTION_CATALOG, APL_CATALOG, EFFECT_CATALOG, FERAL_VERSION };
