import assert from "node:assert/strict";
import test from "node:test";

import {
  INPUT_BINDINGS,
  bindingFromMouseButton,
  bindingFromWheelDelta,
  displayInputBinding,
  isSideMouseBinding,
} from "../core/input-bindings.js";

test("mouse and wheel inputs map to stable configurable binding codes", () => {
  assert.equal(bindingFromMouseButton(0), null);
  assert.equal(bindingFromMouseButton(1), INPUT_BINDINGS.mouseMiddle);
  assert.equal(bindingFromMouseButton(3), INPUT_BINDINGS.mouseBack);
  assert.equal(bindingFromMouseButton(4), INPUT_BINDINGS.mouseForward);
  assert.equal(bindingFromWheelDelta(-1), INPUT_BINDINGS.wheelUp);
  assert.equal(bindingFromWheelDelta(1), INPUT_BINDINGS.wheelDown);
  assert.equal(bindingFromWheelDelta(0), null);
  assert.equal(isSideMouseBinding(INPUT_BINDINGS.mouseBack), true);
  assert.equal(isSideMouseBinding(INPUT_BINDINGS.mouseForward), true);
  assert.equal(isSideMouseBinding(INPUT_BINDINGS.mouseMiddle), false);
});

test("keyboard, side buttons, middle click and wheel directions have readable labels", () => {
  assert.equal(displayInputBinding("KeyQ"), "Q");
  assert.equal(displayInputBinding("Digit2"), "2");
  assert.equal(displayInputBinding(INPUT_BINDINGS.mouseBack), "鼠标侧键（后退）");
  assert.equal(displayInputBinding(INPUT_BINDINGS.mouseForward), "鼠标侧键（前进）");
  assert.equal(displayInputBinding(INPUT_BINDINGS.mouseMiddle), "滚轮按下");
  assert.equal(displayInputBinding(INPUT_BINDINGS.wheelUp), "滚轮向上");
  assert.equal(displayInputBinding(INPUT_BINDINGS.wheelDown), "滚轮向下");
});
