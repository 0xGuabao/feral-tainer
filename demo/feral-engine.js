// Compatibility facade for early Demo imports. The fixed if/else engine was
// retired; all behavior now flows through ResolvedProfile + EffectRuntime.
import { buildInputFromFixture } from "./core/build-input.js";
import { resolveFeralBuild } from "./core/build-resolver.js";
import { BUILD_FIXTURES } from "./data/12.1/build-fixtures.js";
import { FeralTrainerController } from "./trainer-controller.js";

const defaultProfile = resolveFeralBuild(buildInputFromFixture(BUILD_FIXTURES.userValidation));

export const FERAL_SKILLS = defaultProfile.actions;
export const SKILL_BY_ID = defaultProfile.actionById;
export class FeralDemoEngine extends FeralTrainerController {}

export function createDefaultKeybinds(actions = defaultProfile.actions) {
  return Object.fromEntries(actions.map((action) => [action.id, action.defaultCode ?? ""]));
}

export function displayKeyCode(code) {
  if (!code) return "未绑定";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
