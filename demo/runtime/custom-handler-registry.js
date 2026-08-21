import { CUSTOM_HANDLER_DECLARATIONS } from "../data/12.1/feral-game-data.js";
import { executeFeralConvoke } from "./handlers/feral-convoke.js";
import { executeFeralUnseenPredator } from "./handlers/feral-unseen-predator.js";

export class CustomHandlerRegistry {
  constructor() {
    this.handlers = new Map();
    this.declarations = new Map();
  }

  register({ id, description, sourceRefs = [], handler }) {
    if (!id || typeof handler !== "function") {
      throw new Error("customHandler registration requires id and handler");
    }
    if (this.handlers.has(id)) throw new Error(`customHandler '${id}' is already registered`);
    this.handlers.set(id, handler);
    this.declarations.set(id, Object.freeze({ id, description, sourceRefs: [...sourceRefs] }));
    return this;
  }

  execute(id, context) {
    const handler = this.handlers.get(id);
    if (!handler) throw new Error(`customHandler '${id}' is not registered`);
    return handler(context);
  }

  list() {
    return [...this.declarations.values()];
  }
}

export const defaultCustomHandlerRegistry = new CustomHandlerRegistry();

const feralConvokeDeclaration = CUSTOM_HANDLER_DECLARATIONS.find((entry) => entry.id === "feral_convoke");
defaultCustomHandlerRegistry.register({
  ...feralConvokeDeclaration,
  handler: executeFeralConvoke,
});

const unseenPredatorDeclaration = CUSTOM_HANDLER_DECLARATIONS.find((entry) => entry.id === "feral_unseen_predator");
defaultCustomHandlerRegistry.register({
  ...unseenPredatorDeclaration,
  handler: executeFeralUnseenPredator,
});
