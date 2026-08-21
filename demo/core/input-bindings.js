export const INPUT_BINDINGS = Object.freeze({
  mouseMiddle: "MouseMiddle",
  mouseBack: "MouseBack",
  mouseForward: "MouseForward",
  wheelUp: "WheelUp",
  wheelDown: "WheelDown",
});

const MOUSE_BUTTON_BINDINGS = Object.freeze({
  1: INPUT_BINDINGS.mouseMiddle,
  3: INPUT_BINDINGS.mouseBack,
  4: INPUT_BINDINGS.mouseForward,
});

const BINDING_LABELS = Object.freeze({
  [INPUT_BINDINGS.mouseMiddle]: "滚轮按下",
  [INPUT_BINDINGS.mouseBack]: "鼠标侧键（后退）",
  [INPUT_BINDINGS.mouseForward]: "鼠标侧键（前进）",
  [INPUT_BINDINGS.wheelUp]: "滚轮向上",
  [INPUT_BINDINGS.wheelDown]: "滚轮向下",
});

export function bindingFromMouseButton(button) {
  return MOUSE_BUTTON_BINDINGS[button] ?? null;
}

export function bindingFromWheelDelta(deltaY) {
  if (deltaY < 0) return INPUT_BINDINGS.wheelUp;
  if (deltaY > 0) return INPUT_BINDINGS.wheelDown;
  return null;
}

export function isSideMouseBinding(binding) {
  return binding === INPUT_BINDINGS.mouseBack || binding === INPUT_BINDINGS.mouseForward;
}

export function displayInputBinding(binding) {
  if (!binding) return "未绑定";
  if (BINDING_LABELS[binding]) return BINDING_LABELS[binding];
  if (binding.startsWith("Key")) return binding.slice(3);
  if (binding.startsWith("Digit")) return binding.slice(5);
  const aliases = { Space: "空格", Backquote: "`", Minus: "-", Equal: "=" };
  return aliases[binding] ?? binding.replace("Arrow", "");
}
