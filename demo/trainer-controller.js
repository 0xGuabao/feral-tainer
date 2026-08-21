import { buildInputFromFixture } from "./core/build-input.js";
import { InteractiveController } from "./core/interactive-controller.js";
import { BUILD_FIXTURES } from "./data/12.1/build-fixtures.js";

const DEFAULT_BUILD_INPUT = buildInputFromFixture(BUILD_FIXTURES.userValidation);

export class FeralTrainerController extends InteractiveController {
  constructor(options = {}) {
    super({
      ...options,
      defaultBuildInput: options.defaultBuildInput ?? DEFAULT_BUILD_INPUT,
    });
  }
}

const defaultController = new FeralTrainerController();

export const startSession = (options) => defaultController.startSession(options);
export const pressAction = (input) => defaultController.pressAction(input);
export const advanceTime = (milliseconds) => defaultController.advanceTime(milliseconds);
export const setActiveTarget = (targetIndex) => defaultController.setActiveTarget(targetIndex);
export const getSnapshot = () => defaultController.getSnapshot();
export const getRecommendation = () => defaultController.getRecommendation();
export const drainEvents = () => defaultController.drainEvents();
export const resetSession = () => defaultController.resetSession();

export { InteractiveController };
