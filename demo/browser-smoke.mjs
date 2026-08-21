import assert from "node:assert/strict";

const USER_VALIDATION_TALENT_CODE = "CcGADBD3hSPCL9Y9gz68WcKvMAAAAAAwgZwYmZmxstMPwyYbmZGzMDAAAAbgZzwYmBzYWGzMzYMDDAAAAAgBGAAAAmZZWmZmZWmZxsMzyGMz8AALmBDAgZGMzGGA";
const BROWSER_IMPORTED_PROFILE = [
  'druid="Imported <img src=x onerror=globalThis.__simcInjected=true>"',
  "spec=feral",
  "level=90",
  `talents=${USER_VALIDATION_TALENT_CODE}`,
  "iterations=100",
].join("\n");

const port = process.env.CDP_PORT ?? "9223";
const pageReadyTimeoutMs = Number(process.env.PAGE_READY_TIMEOUT_MS ?? "30000");
assert(
  Number.isInteger(pageReadyTimeoutMs) && pageReadyTimeoutMs >= 1000 && pageReadyTimeoutMs <= 120000,
  "PAGE_READY_TIMEOUT_MS 必须是 1000～120000 的整数",
);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const pageTarget = process.env.CDP_TARGET_ID
  ? targets.find((target) => target.id === process.env.CDP_TARGET_ID)
  : targets.find((target) => target.type === "page" && target.url.includes("/demo/"));

assert(pageTarget, "没有找到已打开的 Demo 页面");

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const pending = new Map();

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(details.exception?.description ?? details.text);
  }
  return result.result.value;
}

async function press(code, key) {
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keyup", { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
}

async function clickAt(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`找不到触控目标：${selector}`)});
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      hitSkillId: hit?.closest(".skill-button")?.dataset.skillId ?? null,
    };
  })()`);
  await evaluate(`(() => {
    const hit = document.elementFromPoint(${point.x}, ${point.y});
    hit?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: ${point.x},
      clientY: ${point.y},
    }));
  })()`);
  return point;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForPageReady(timeoutMs = pageReadyTimeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluate(`(() => {
      const images = [...document.querySelectorAll(".wow-icon-image")];
      return {
        failedIconSources: [...new Set(images
          .filter((image) => image.dataset.iconLoadStatus === "failed")
          .map((image) => image.dataset.iconSource || image.src))],
        ready: Boolean(
          document.readyState !== "loading"
          && document.querySelector(".buff-tracker")
          && document.querySelector(".monitor-stack")
          && document.querySelector(".skill-button")
          && images.every((image) => image.complete
            && image.naturalWidth > 0
            && image.dataset.iconLoadStatus !== "retrying")
        ),
      };
    })()`);
    if (state.failedIconSources.length) {
      throw new Error(`图标资源重试后仍失败：${state.failedIconSources.join(", ")}`);
    }
    if (state.ready) return;
    await wait(100);
  }
  throw new Error(`Demo 页面在 ${timeoutMs}ms 内未完成初始化`);
}

async function waitForIconLoads(selector = ".wow-icon-image", timeoutMs = pageReadyTimeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evaluate(`(() => {
      const images = [...document.querySelectorAll(${JSON.stringify(selector)})];
      return {
        failedIconSources: [...new Set(images
          .filter((image) => image.dataset.iconLoadStatus === "failed")
          .map((image) => image.dataset.iconSource || image.src))],
        ready: images.every((image) => image.complete
          && image.naturalWidth === 56
          && image.naturalHeight === 56
          && image.dataset.iconLoadStatus !== "retrying"),
      };
    })()`);
    if (state.failedIconSources.length) {
      throw new Error(`图标资源重试后仍失败：${state.failedIconSources.join(", ")}`);
    }
    if (state.ready) return;
    await wait(100);
  }
  throw new Error(`图标资源在 ${timeoutMs}ms 内未完成加载：${selector}`);
}

async function verifyTransientIconRecovery() {
  const recovery = await evaluate(`new Promise((resolve, reject) => {
    const source = document.querySelector(".wow-icon-image")?.dataset.iconSource;
    if (!source) return reject(new Error("没有可用于重试验证的图标"));
    const image = document.createElement("img");
    image.className = "wow-icon-image";
    image.dataset.iconSource = source;
    image.dataset.iconLoadStatus = "pending";
    image.hidden = true;
    const timeout = setTimeout(() => {
      image.remove();
      reject(new Error("图标瞬时失败重试验证超时"));
    }, 5000);
    image.addEventListener("load", () => {
      clearTimeout(timeout);
      const result = {
        status: image.dataset.iconLoadStatus,
        retries: image.dataset.iconRetryCount,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      image.remove();
      resolve(result);
    }, { once: true });
    image.src = "data:image/jpeg;base64,broken";
    document.body.append(image);
  })`);
  assert.deepEqual(recovery, { status: "loaded", retries: "1", width: 56, height: 56 });
}

try {
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1828,
    height: 1028,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForPageReady();
  await verifyTransientIconRecovery();
  await evaluate(`{
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("ashamane-lab-")) localStorage.removeItem(key);
    }
    localStorage.setItem("ashamane-lab-simc-profile-v1", ${JSON.stringify(BROWSER_IMPORTED_PROFILE)});
    localStorage.setItem("ashamane-lab-selected-build-v1", "__simc_import__");
  }`);
  await command("Page.reload", { ignoreCache: true });
  await wait(100);
  await waitForPageReady();
  const legacyMigration = await evaluate(`({
    buildValue: document.querySelector("#build-select").value,
    profileCacheKeys: Object.keys(localStorage).filter((key) => key.startsWith("ashamane-lab-profile-cache-v1:")),
    selectionKeys: Object.keys(localStorage).filter((key) => key.startsWith("ashamane-lab-selected-build-v2:")),
    legacyRetained: localStorage.getItem("ashamane-lab-simc-profile-v1") !== null,
    feedback: document.querySelector("#feedback").textContent,
    toast: document.querySelector("#toast").textContent,
    migrationEvent: (() => {
      const key = Object.keys(localStorage).find((entry) => entry.startsWith("ashamane-lab-profile-cache-v1:"));
      const record = key ? JSON.parse(localStorage.getItem(key)) : null;
      return record?.migrationHistory?.at(-1) ?? null;
    })(),
  })`);
  assert.equal(legacyMigration.buildValue, "__simc_import__");
  assert.equal(legacyMigration.profileCacheKeys.length, 1);
  assert.equal(legacyMigration.selectionKeys.length, 1);
  assert.equal(legacyMigration.legacyRetained, true, "迁移成功后必须保留旧键作为回滚点");
  assert.equal(legacyMigration.migrationEvent?.type, "legacy-key-migration");
  assert.equal(legacyMigration.migrationEvent?.status, "succeeded");
  assert.match(`${legacyMigration.feedback} ${legacyMigration.toast}`, /安全重解析|迁移并重解析/);
  await evaluate(`document.querySelector("#clear-simc-import").click()`);
  await command("Page.reload", { ignoreCache: true });
  await wait(100);
  await waitForPageReady();
  const initial = await evaluate(`({
    title: document.title,
    skills: document.querySelectorAll(".skill-button").length,
    skillIcons: document.querySelectorAll(".skill-button .wow-icon-image").length,
    buffs: document.querySelectorAll(".buff-card").length,
    buffIcons: document.querySelectorAll(".buff-card .wow-icon-image").length,
    brokenIcons: [...document.querySelectorAll(".wow-icon-image")].filter((image) => !image.complete || image.naturalWidth !== 56 || image.naturalHeight !== 56).length,
    cooldownIconsConsistent: [...document.querySelectorAll(".cooldown-item")].every((item) => {
      const action = document.querySelector('.skill-button[data-skill-id="' + item.dataset.skillId + '"]');
      return action?.querySelector(".wow-icon-image")?.dataset.iconFileId === item.querySelector(".wow-icon-image")?.dataset.iconFileId;
    }),
    targets: document.querySelectorAll(".target-tab").length,
    targetHealthBars: document.querySelectorAll(".target-health").length,
    sequenceTop: document.querySelector(".sequence-panel").getBoundingClientRect().top,
    sequenceBottom: document.querySelector(".sequence-panel").getBoundingClientRect().bottom,
    buffTrackerLeft: document.querySelector(".buff-tracker").getBoundingClientRect().left,
    buffTrackerTop: document.querySelector(".buff-tracker").getBoundingClientRect().top,
    buffTrackerWidth: document.querySelector(".buff-tracker").getBoundingClientRect().width,
    combatLogLeft: document.querySelector(".combat-log-panel").getBoundingClientRect().left,
    combatLogTop: document.querySelector(".combat-log-panel").getBoundingClientRect().top,
    combatLogBottom: document.querySelector(".combat-log-panel").getBoundingClientRect().bottom,
    cooldownTop: document.querySelector(".monitor-stack").getBoundingClientRect().top,
    cooldownBottom: document.querySelector(".monitor-stack").getBoundingClientRect().bottom,
    auraMonitorBottom: document.querySelector(".aura-monitor-row").getBoundingClientRect().bottom,
    cooldownRowTop: document.querySelector(".cooldown-monitor-row").getBoundingClientRect().top,
    dotMonitorRowTop: document.querySelector(".dot-monitor-row").getBoundingClientRect().top,
    resourceLeft: document.querySelector(".resource-bars").getBoundingClientRect().left,
    resourceTop: document.querySelector(".resource-bars").getBoundingClientRect().top,
    resourceBottom: document.querySelector(".resource-bars").getBoundingClientRect().bottom,
    resourceWidth: document.querySelector(".resource-bars").getBoundingClientRect().width,
    comboWidth: document.querySelector(".combo-resource-bar").getBoundingClientRect().width,
    energyWidth: document.querySelector(".energy-resource-bar").getBoundingClientRect().width,
    monitorWidth: document.querySelector(".monitor-stack").getBoundingClientRect().width,
    selectedAuraItems: document.querySelectorAll(".aura-monitor-item").length,
    selectedAuraEmpty: document.querySelectorAll(".monitor-empty").length,
    sessionDuration: document.querySelector("#session-duration-total").textContent,
    dotMonitorIcons: document.querySelectorAll(".dot-monitor-item .wow-icon-image").length,
    channelHidden: document.querySelector("#channel-bar").hidden,
    actionTop: document.querySelector(".action-section").getBoundingClientRect().top,
    buildOptions: document.querySelectorAll("#build-select option").length,
    versionedAssets: [
      ...document.querySelectorAll('link[rel="stylesheet"]'),
      document.querySelector('script[type="module"]')
    ].every((element) => /[?&]h=[0-9a-f]{64}(?:&|$)/.test(element?.getAttribute(element.tagName === "LINK" ? "href" : "src") ?? "")),
    unhashedLoadedAssets: performance.getEntriesByType("resource").filter((entry) => {
      const url = new URL(entry.name);
      return url.pathname.startsWith("/demo/")
        && !url.pathname.endsWith("/release.json")
        && /\.(?:js|css|jpg|jpeg|png|svg)$/.test(url.pathname)
        && !/[?&]h=[0-9a-f]{64}(?:&|$)/.test(url.search);
    }).map((entry) => entry.name),
    actionIds: [...document.querySelectorAll(".skill-button")].map((button) => button.dataset.skillId),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  })`);
  assert.equal(initial.skills, 10);
  assert.equal(initial.skillIcons, initial.skills);
  assert.equal(initial.buffIcons, initial.buffs);
  assert.equal(initial.brokenIcons, 0);
  assert.equal(initial.cooldownIconsConsistent, true);
  assert.equal(initial.targets, 1);
  assert.equal(initial.targetHealthBars, 0);
  assert(initial.dotMonitorIcons > 0);
  assert.equal(initial.channelHidden, true);
  assert.equal(initial.buildOptions, 4);
  assert.equal(initial.versionedAssets, true, "入口 CSS/JS 必须带内容哈希，避免 H5 混用新 HTML 与旧脚本");
  assert.deepEqual(initial.unhashedLoadedAssets, [], "浏览器加载的 JS/CSS/图标必须使用内容哈希 URL");
  assert(initial.actionIds.includes("moonfire"));
  assert(!initial.actionIds.includes("primalWrath"));
  assert(initial.sequenceTop < initial.resourceTop, "施法顺序应位于资源与监控区上方");
  assert(initial.buffTrackerTop < 20, "全部增益应位于屏幕顶部");
  assert(Math.abs(initial.buffTrackerLeft + initial.buffTrackerWidth / 2 - initial.viewportWidth / 2) < 2, "全部增益应位于顶部居中");
  assert(initial.combatLogLeft < 30, "战斗记录应位于左侧");
  assert(initial.combatLogTop < initial.viewportHeight * 0.55, "战斗记录应从屏幕中下部开始");
  assert(initial.combatLogBottom > initial.viewportHeight * 0.8, "战斗记录应位于屏幕下部");
  assert(initial.resourceLeft > initial.viewportWidth * 0.3 && initial.resourceLeft < initial.viewportWidth * 0.55, "资源条应位于屏幕中央");
  assert(initial.resourceTop > initial.viewportHeight * 0.35 && initial.resourceTop < initial.viewportHeight * 0.58, "资源条应位于屏幕中部");
  assert.equal(initial.comboWidth, initial.energyWidth, "连击点条与能量条必须严格同宽");
  assert.equal(initial.resourceWidth, initial.monitorWidth, "资源条与冷却管理器必须严格同宽");
  assert(initial.cooldownTop > initial.resourceBottom, "冷却管理器应位于资源条下方");
  assert(initial.cooldownBottom < initial.actionTop, "冷却管理器应位于技能栏上方");
  assert(initial.sequenceBottom < initial.resourceTop, "施法顺序不应遮挡资源区域");
  assert(initial.auraMonitorBottom <= initial.cooldownRowTop, "已选增益必须与冷却技能按行隔离");
  assert(initial.cooldownRowTop < initial.dotMonitorRowTop, "技能冷却必须位于 DoT 监控上方");
  assert.equal(initial.selectedAuraItems, 0);
  assert.equal(initial.selectedAuraEmpty, 1);
  assert.equal(initial.sessionDuration, "/ 01:00");

  const importedProfile = BROWSER_IMPORTED_PROFILE;
  const simcImport = await evaluate(`(() => {
    globalThis.__simcInjected = false;
    document.querySelector("#open-simc-import").click();
    const input = document.querySelector("#simc-profile-input");
    input.value = ${JSON.stringify(importedProfile)};
    document.querySelector("#apply-simc-import").click();
    return {
      dialogOpen: document.querySelector("#simc-import-dialog").open,
      buildValue: document.querySelector("#build-select").value,
      buildOptions: document.querySelectorAll("#build-select option").length,
      selectedLabel: document.querySelector("#build-select").selectedOptions[0].textContent,
      nestedImages: document.querySelectorAll("#build-select img").length,
      injected: globalThis.__simcInjected,
      persisted: JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("ashamane-lab-profile-cache-v1:")))).rawProfileText,
      statusClass: document.querySelector("#simc-import-status").className,
      statusText: document.querySelector("#simc-import-status").textContent,
      feedback: document.querySelector("#feedback").textContent,
      actionIds: [...document.querySelectorAll(".skill-button")].map((button) => button.dataset.skillId),
    };
  })()`);
  assert.equal(simcImport.dialogOpen, true);
  assert.equal(simcImport.buildValue, "__simc_import__");
  assert.equal(simcImport.buildOptions, 5);
  assert.match(simcImport.selectedLabel, /Imported <img/);
  assert.equal(simcImport.nestedImages, 0, "导入角色名必须作为纯文本写入构筑选项");
  assert.equal(simcImport.injected, false, "导入 Profile 不得执行角色名中的 HTML");
  assert.equal(simcImport.persisted, importedProfile);
  assert.match(simcImport.statusClass, /is-success/);
  assert.match(simcImport.statusText, /1 个未应用字段/);
  assert.match(simcImport.statusText, /iterations/);
  assert.match(simcImport.feedback, /Imported <img/);
  assert(simcImport.actionIds.includes("moonfire"));
  assert(!simcImport.actionIds.includes("primalWrath"));

  const failedImport = await evaluate(`(() => {
    const profileCacheKey = Object.keys(localStorage).find((key) => key.startsWith("ashamane-lab-profile-cache-v1:"));
    const previousProfile = localStorage.getItem(profileCacheKey);
    const previousBuild = document.querySelector("#build-select").value;
    document.querySelector("#simc-profile-input").value = ${JSON.stringify(`druid=WrongSpec\nspec=balance\ntalents=${USER_VALIDATION_TALENT_CODE}`)};
    document.querySelector("#apply-simc-import").click();
    return {
      previousProfile,
      persistedProfile: localStorage.getItem(profileCacheKey),
      previousBuild,
      currentBuild: document.querySelector("#build-select").value,
      statusClass: document.querySelector("#simc-import-status").className,
      statusText: document.querySelector("#simc-import-status").textContent,
    };
  })()`);
  assert.equal(failedImport.persistedProfile, failedImport.previousProfile, "解析失败不能覆盖已保存 Profile");
  assert.equal(failedImport.currentBuild, failedImport.previousBuild, "解析失败不能切换当前构筑");
  assert.match(failedImport.statusClass, /is-error/);
  assert.match(failedImport.statusText, /not supported/);
  await evaluate(`(() => {
    document.querySelector("#simc-import-dialog").close();
    const select = document.querySelector("#build-select");
    select.value = "userValidation";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);

  const durationControl = await evaluate(`(() => {
    document.querySelector('[data-duration-seconds="30"]').click();
    const presetDuration = document.querySelector("#session-duration-total").textContent;
    const input = document.querySelector("#custom-duration");
    input.value = "45";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      presetDuration,
      customDuration: document.querySelector("#session-duration-total").textContent,
      inputValue: input.value,
      activePresets: [...document.querySelectorAll("#duration-presets .is-active")].map((button) => button.dataset.durationSeconds)
    };
  })()`);
  assert.equal(durationControl.presetDuration, "/ 00:30");
  assert.equal(durationControl.customDuration, "/ 00:45");
  assert.equal(durationControl.inputValue, "45");
  assert.deepEqual(durationControl.activePresets, []);

  const buffFiltering = await evaluate(`(() => {
    const input = document.querySelector("#buff-filter");
    const cards = [...document.querySelectorAll(".buff-card")];
    const idCard = cards.find((card) => card.dataset.spellId);
    const apply = (value) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return [...document.querySelectorAll(".buff-card:not([hidden])")].map((card) => ({
        name: card.dataset.buffName,
        spellId: card.dataset.spellId,
      }));
    };
    const bySpellId = apply(idCard.dataset.spellId);
    const byName = apply(idCard.dataset.buffName);
    apply("");
    return { spellId: idCard.dataset.spellId, name: idCard.dataset.buffName, bySpellId, byName };
  })()`);
  assert(buffFiltering.bySpellId.length > 0, "应可按法术 ID 筛选增益");
  assert(buffFiltering.bySpellId.every((buff) => buff.spellId === buffFiltering.spellId), "法术 ID 筛选结果必须精确匹配");
  assert(buffFiltering.byName.length > 0, "应可按名称筛选增益");
  assert(buffFiltering.byName.every((buff) => buff.name.includes(buffFiltering.name)), "名称筛选结果必须匹配增益名称");

  const auraMonitorSelection = await evaluate(`(() => {
    document.querySelector("#open-aura-monitor").click();
    const filter = document.querySelector("#aura-monitor-filter");
    filter.value = "猛虎";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    const choice = document.querySelector('[data-aura-monitor-id="tigersFury"]');
    const input = choice.querySelector('input[type="checkbox"]');
    input.click();
    const monitor = document.querySelector('.aura-monitor-item[data-aura-id="tigersFury"]');
    return {
      dialogOpen: document.querySelector("#aura-monitor-dialog").open,
      visibleChoices: document.querySelectorAll(".aura-monitor-choice:not([hidden])").length,
      selectedCount: document.querySelectorAll(".aura-monitor-item").length,
      checked: input.checked,
      iconMatchesSkill: monitor.querySelector(".wow-icon-image").dataset.iconFileId === document.querySelector('.skill-button[data-skill-id="tigersFury"] .wow-icon-image').dataset.iconFileId,
      text: document.querySelector("#aura-monitor-hint").textContent
    };
  })()`);
  assert.equal(auraMonitorSelection.dialogOpen, true);
  assert(auraMonitorSelection.visibleChoices > 0, "增益选择器应支持按名称筛选");
  assert.equal(auraMonitorSelection.selectedCount, 1);
  assert.equal(auraMonitorSelection.checked, true);
  assert.equal(auraMonitorSelection.iconMatchesSkill, true, "增益监控必须使用 Catalog 中对应技能图标");
  assert.match(auraMonitorSelection.text, /1 个增益/);
  await evaluate(`document.querySelector("#aura-monitor-dialog").close()`);

  await press("Space", " ");
  let shortcutState = await evaluate(`({
    running: document.querySelector("#session-status").classList.contains("is-running"),
    label: document.querySelector("#start-pause .button-label").textContent
  })`);
  assert.equal(shortcutState.running, true);
  assert.equal(shortcutState.label, "暂停");
  await press("Space", " ");
  shortcutState = await evaluate(`({
    running: document.querySelector("#session-status").classList.contains("is-running"),
    label: document.querySelector("#start-pause .button-label").textContent
  })`);
  assert.equal(shortcutState.running, false);
  assert.equal(shortcutState.label, "继续");
  await press("Space", " ");
  const touchActivation = await evaluate(`(() => {
    const button = document.querySelector('.skill-button[data-skill-id="tigersFury"]');
    const rect = button.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, pointerId: 17, pointerType: "touch", clientX: rect.left + 4, clientY: rect.top + 4 };
    button.dispatchEvent(new PointerEvent("pointerdown", options));
    button.dispatchEvent(new PointerEvent("pointerup", options));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return {
      casts: document.querySelectorAll(".sequence-entry").length,
      focused: document.activeElement === button,
      feedback: document.querySelector("#action-feedback").textContent,
      waiting: button.classList.contains("is-waiting")
    };
  })()`);
  assert.equal(touchActivation.casts, 1, "一次触摸及其后续 click 只能施放一次");
  assert.equal(touchActivation.focused, false, "触摸施法后不应残留按钮选中焦点");
  assert.match(touchActivation.feedback, /猛虎之怒已施放/);
  assert.equal(touchActivation.waiting, false);
  await press("KeyE", "e");
  await press("Digit1", "1");
  const blockedTouch = await evaluate(`(() => {
    const button = document.querySelector('.skill-button[data-skill-id="rip"]');
    const rect = button.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, pointerId: 18, pointerType: "touch", clientX: rect.left + 4, clientY: rect.top + 4 };
    button.dispatchEvent(new PointerEvent("pointerdown", options));
    button.dispatchEvent(new PointerEvent("pointerup", options));
    const repeatedOptions = { ...options, pointerId: 19 };
    button.dispatchEvent(new PointerEvent("pointerdown", repeatedOptions));
    button.dispatchEvent(new PointerEvent("pointerup", repeatedOptions));
    return {
      casts: document.querySelectorAll(".sequence-entry").length,
      feedback: document.querySelector("#action-feedback").textContent,
      waiting: button.classList.contains("is-waiting"),
      successfulMetric: document.querySelector("#metric-casts").textContent,
      combatLog: document.querySelector("#combat-log-list").innerText
    };
  })()`);
  assert.equal(blockedTouch.casts, 3, "频繁输入期间只记录成功施放的技能");
  assert.match(blockedTouch.feedback, /公共冷却/);
  assert.equal(blockedTouch.waiting, true, "等待公共冷却的输入应给出中性等待反馈");
  assert.equal(blockedTouch.successfulMetric, "3");
  assert.doesNotMatch(blockedTouch.combatLog, /未施放/);
  const gcdVisual = await evaluate(`({
    shredGcdActive: document.querySelector('.skill-button[data-skill-id="shred"]').classList.contains("is-gcd-active"),
    shredUnavailable: document.querySelector('.skill-button[data-skill-id="shred"]').classList.contains("is-unavailable"),
    recommendationsSteady: [...document.querySelectorAll(".skill-button.is-recommended")].every((button) => getComputedStyle(button).animationName === "none")
  })`);
  assert.equal(gcdVisual.shredGcdActive, true);
  assert.equal(gcdVisual.shredUnavailable, false, "GCD 不应让可用技能图标整体灰化闪动");
  assert.equal(gcdVisual.recommendationsSteady, true, "推荐技能应使用稳定高亮而非循环闪烁");
  await wait(1650);
  await press("Digit2", "2");

  const firstSequence = await evaluate(`({
    count: document.querySelectorAll(".sequence-entry").length,
    text: document.querySelector("#sequence-list").innerText,
    skillIds: [...document.querySelectorAll(".sequence-entry")].map((entry) => entry.dataset.skillId),
    running: document.querySelector("#session-status").classList.contains("is-running"),
    cooldownItems: document.querySelectorAll(".cooldown-item").length,
    tigerCooldown: document.querySelector('.cooldown-item[data-skill-id="tigersFury"] .cooldown-number').textContent,
    berserkCooldown: document.querySelector('.cooldown-item[data-skill-id="berserk"] .cooldown-number').textContent,
    recommendedSlots: document.querySelectorAll(".skill-button.is-recommended").length,
    combatLogCount: document.querySelectorAll(".combat-log-line").length,
    combatLogText: document.querySelector("#combat-log-list").innerText,
    sequenceIcons: document.querySelectorAll(".sequence-entry .wow-icon-image").length,
    tigerAuraMonitorActive: document.querySelector('.aura-monitor-item[data-aura-id="tigersFury"]').classList.contains("is-active"),
    tigerAuraMonitorRemaining: document.querySelector('.aura-monitor-item[data-aura-id="tigersFury"] .cooldown-number').textContent,
    rakeDotActive: document.querySelector('.dot-monitor-item[data-dot-id="rake"]').classList.contains("is-active"),
    rakeCoverage: document.querySelector('.dot-monitor-item[data-dot-id="rake"] .dot-coverage').textContent
  })`);
  assert.equal(firstSequence.count, 4);
  assert.equal(firstSequence.sequenceIcons, firstSequence.count);
  assert.equal(firstSequence.rakeDotActive, true);
  assert.equal(firstSequence.rakeCoverage, "1/1");
  assert.deepEqual(firstSequence.skillIds, ["tigersFury", "berserk", "rake", "shred"]);
  assert.equal(firstSequence.running, true);
  assert.equal(firstSequence.cooldownItems, 4);
  assert.notEqual(firstSequence.tigerCooldown, "");
  assert.notEqual(firstSequence.berserkCooldown, "");
  assert.equal(firstSequence.tigerAuraMonitorActive, true);
  assert.notEqual(firstSequence.tigerAuraMonitorRemaining, "");
  assert.equal(firstSequence.recommendedSlots, 1);
  assert(firstSequence.combatLogCount >= 4);
  assert.match(firstSequence.combatLogText, /猛虎之怒/);

  await evaluate(`(() => {
    const input = document.querySelector("#custom-duration");
    input.value = "50";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const pendingDuration = await evaluate(`({
    total: document.querySelector("#session-duration-total").textContent,
    feedback: document.querySelector("#action-feedback").textContent
  })`);
  assert.equal(pendingDuration.total, "/ 00:45", "运行中改时长不能改变本轮的结束基准");
  assert.match(pendingDuration.feedback, /重新开始时生效/);

  await evaluate(`{
    document.querySelector("#open-keybinds").click();
    document.querySelector('[data-bind-skill="rake"]').click();
  }`);
  await press("Space", " ");
  const reservedSpace = await evaluate(`({
    listeningText: document.querySelector('[data-bind-skill="rake"]').textContent.trim(),
    hint: document.querySelector("#keybind-hint").textContent
  })`);
  assert.equal(reservedSpace.listeningText, "按新键…");
  assert.match(reservedSpace.hint, /空格键保留/);
  const pointingBindings = await evaluate(`(() => {
    const dispatchMouse = (type, button) => {
      const event = new MouseEvent(type, {
        button,
        buttons: type === "mousedown" ? 1 << button : 0,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const bindMouse = (skillId, button) => {
      document.querySelector('[data-bind-skill="' + skillId + '"]').click();
      return {
        down: dispatchMouse("mousedown", button),
        up: dispatchMouse("mouseup", button),
        aux: dispatchMouse("auxclick", button),
        label: document.querySelector('[data-bind-skill="' + skillId + '"]').textContent.trim(),
      };
    };
    const bindWheel = (skillId, deltaY) => {
      document.querySelector('[data-bind-skill="' + skillId + '"]').click();
      const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return {
        defaultPrevented: event.defaultPrevented,
        label: document.querySelector('[data-bind-skill="' + skillId + '"]').textContent.trim(),
      };
    };
    const configured = {
      back: bindMouse("shred", 3),
      forward: bindMouse("swipe", 4),
      middle: bindMouse("rip", 1),
      wheelUp: bindWheel("ferociousBite", -120),
      wheelDown: bindWheel("feralFrenzy", 120),
    };
    document.querySelector("#reset-keybinds").click();
    const unboundSide = {
      down: dispatchMouse("mousedown", 3),
      up: dispatchMouse("mouseup", 3),
      aux: dispatchMouse("auxclick", 3),
    };
    const unboundWheelEvent = new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true });
    document.dispatchEvent(unboundWheelEvent);
    return {
      ...configured,
      unboundSide,
      unboundWheelDefaultPrevented: unboundWheelEvent.defaultPrevented,
    };
  })()`);
  assert.deepEqual(pointingBindings.back, {
    down: true,
    up: true,
    aux: true,
    label: "鼠标侧键（后退）",
  });
  assert.deepEqual(pointingBindings.forward, {
    down: true,
    up: true,
    aux: true,
    label: "鼠标侧键（前进）",
  });
  assert.deepEqual(pointingBindings.middle, {
    down: true,
    up: true,
    aux: true,
    label: "滚轮按下",
  });
  assert.deepEqual(pointingBindings.wheelUp, { defaultPrevented: true, label: "滚轮向上" });
  assert.deepEqual(pointingBindings.wheelDown, { defaultPrevented: true, label: "滚轮向下" });
  assert.deepEqual(pointingBindings.unboundSide, { down: true, up: true, aux: true });
  assert.equal(pointingBindings.unboundWheelDefaultPrevented, false, "未绑定滚轮时必须保留页面滚动");
  await evaluate(`document.querySelector('[data-bind-skill="rake"]').click()`);
  await press("KeyZ", "z");
  const rebound = await evaluate(`({
    rakeKey: document.querySelector('[data-bind-skill="rake"]').textContent.trim(),
    dialogOpen: document.querySelector("#keybind-dialog").open
  })`);
  assert.equal(rebound.rakeKey, "Z");
  assert.equal(rebound.dialogOpen, true);
  await evaluate(`document.querySelector("#keybind-dialog").close()`);

  await wait(1650);
  await press("KeyZ", "z");
  const reboundSequenceCount = await evaluate(`document.querySelectorAll(".sequence-entry").length`);
  assert.equal(reboundSequenceCount, 5);

  const sideBindingCapture = await evaluate(`(() => {
    document.querySelector("#open-keybinds").click();
    document.querySelector('[data-bind-skill="shred"]').click();
    const event = new MouseEvent("mousedown", { button: 3, buttons: 8, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    const label = document.querySelector('[data-bind-skill="shred"]').textContent.trim();
    document.querySelector("#keybind-dialog").close();
    return { defaultPrevented: event.defaultPrevented, label };
  })()`);
  assert.deepEqual(sideBindingCapture, { defaultPrevented: true, label: "鼠标侧键（后退）" });
  await wait(1650);
  const sideCast = await evaluate(`(() => {
    const before = document.querySelectorAll(".sequence-entry").length;
    const href = location.href;
    const dispatch = (type) => {
      const event = new MouseEvent(type, {
        button: 3,
        buttons: type === "mousedown" ? 8 : 0,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      before,
      down: dispatch("mousedown"),
      up: dispatch("mouseup"),
      aux: dispatch("auxclick"),
      after: document.querySelectorAll(".sequence-entry").length,
      lastSkillId: document.querySelector(".sequence-entry:last-child")?.dataset.skillId,
      navigationPrevented: location.href === href,
    };
  })()`);
  assert.deepEqual(sideCast, {
    before: 5,
    down: true,
    up: true,
    aux: true,
    after: 6,
    lastSkillId: "shred",
    navigationPrevented: true,
  });
  await evaluate(`{
    document.querySelector("#open-keybinds").click();
    document.querySelector('[data-bind-skill="shred"]').click();
  }`);
  await press("Digit2", "2");
  await evaluate(`document.querySelector("#keybind-dialog").close()`);

  // The runtime mouse cast consumes the deterministic proc stream. Reload so
  // the pre-existing combat assertions continue from their original seed.
  await command("Page.reload", { ignoreCache: true });
  await wait(100);
  await waitForPageReady();

  await press("Backspace", "Backspace");
  const resetByBackspace = await evaluate(`({
    sequenceCount: document.querySelectorAll(".sequence-entry").length,
    sessionTime: document.querySelector("#session-time").textContent,
    running: document.querySelector("#session-status").classList.contains("is-running"),
    toast: document.querySelector("#toast").textContent
  })`);
  assert.equal(resetByBackspace.sequenceCount, 0);
  assert.equal(resetByBackspace.sessionTime, "00:00.0");
  assert.equal(resetByBackspace.running, false);
  assert.equal(resetByBackspace.toast, "训练已重置");
  assert.equal(await evaluate(`document.querySelector("#session-duration-total").textContent`), "/ 00:50");

  await press("Space", " ");
  await press("KeyV", "v");
  await wait(120);
  const channelStart = await evaluate(`({
    hidden: document.querySelector("#channel-bar").hidden,
    name: document.querySelector("#channel-name").textContent,
    remaining: Number.parseFloat(document.querySelector("#channel-time").textContent),
    fillWidth: document.querySelector("#channel-fill").getBoundingClientRect().width,
    barWidth: document.querySelector("#channel-bar").getBoundingClientRect().width,
    energyWidth: document.querySelector(".energy-resource-bar").getBoundingClientRect().width,
    ariaValue: Number(document.querySelector("#channel-bar").getAttribute("aria-valuenow"))
  })`);
  await wait(500);
  const channelLater = await evaluate(`({
    hidden: document.querySelector("#channel-bar").hidden,
    remaining: Number.parseFloat(document.querySelector("#channel-time").textContent),
    fillWidth: document.querySelector("#channel-fill").getBoundingClientRect().width,
    ariaValue: Number(document.querySelector("#channel-bar").getAttribute("aria-valuenow"))
  })`);
  assert.equal(channelStart.hidden, false);
  assert.equal(channelStart.name, "万灵之召");
  assert.equal(channelStart.barWidth, channelStart.energyWidth);
  assert(channelStart.ariaValue > channelLater.ariaValue);
  assert(channelStart.fillWidth > channelLater.fillWidth, "持续施法条应随剩余时间从右向左回退");
  assert(channelStart.remaining > channelLater.remaining);
  assert.equal(channelLater.hidden, false);
  await press("Backspace", "Backspace");
  assert.equal(await evaluate(`document.querySelector("#channel-bar").hidden`), true);

  const targetCounts = [];
  for (const count of [3, 5, 1]) {
    await evaluate(`document.querySelector('[data-target-count="${count}"]').click()`);
    targetCounts.push(await evaluate(`document.querySelectorAll(".target-tab").length`));
  }
  assert.deepEqual(targetCounts, [3, 5, 1]);

  await evaluate(`(() => {
    const select = document.querySelector("#build-select");
    select.value = "primalWrath";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitForIconLoads(".skill-button .wow-icon-image");
  const switchedBuild = await evaluate(`({
      actionIds: [...document.querySelectorAll(".skill-button")].map((button) => button.dataset.skillId),
      disabledText: document.querySelector("#feedback").textContent,
      brokenActionIcons: [...document.querySelectorAll(".skill-button .wow-icon-image")].filter((image) => !image.complete || image.naturalWidth !== 56).length,
      selectedAuraItems: document.querySelectorAll(".aura-monitor-item").length,
      selectedAuraEmpty: document.querySelectorAll(".monitor-empty").length,
      buildValue: document.querySelector("#build-select").value
    })`);
  assert.equal(switchedBuild.buildValue, "primalWrath");
  assert(switchedBuild.actionIds.includes("primalWrath"));
  assert(!switchedBuild.actionIds.includes("moonfire"));
  assert.equal(switchedBuild.brokenActionIcons, 0);
  assert.equal(switchedBuild.selectedAuraItems, 0, "构筑切换后不应显示另一构筑保存的增益监控");
  assert.equal(switchedBuild.selectedAuraEmpty, 1);
  assert.match(switchedBuild.disabledText, /原始之怒多目标构筑/);

  await evaluate(`(() => {
    const select = document.querySelector("#build-select");
    select.value = "simcWildstalker";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitForIconLoads();
  const wildstalkerCatalog = await evaluate(`({
    bloodseekerIcon: document.querySelector('.dot-monitor-item[data-dot-id="bloodseekerVines"] .wow-icon-image')?.dataset.iconFileId,
    implantIcon: document.querySelector('.buff-card[data-buff="implant"] .wow-icon-image')?.dataset.iconFileId,
    brokenIcons: [...document.querySelectorAll(".wow-icon-image")].filter((image) => !image.complete || image.naturalWidth !== 56 || image.naturalHeight !== 56).length
  })`);
  assert.equal(wildstalkerCatalog.bloodseekerIcon, "134197");
  assert.equal(wildstalkerCatalog.implantIcon, "132105");
  assert.equal(wildstalkerCatalog.brokenIcons, 0);

  await press("Space", " ");
  await press("KeyQ", "q");
  await press("KeyZ", "z");
  await wait(100);
  const wildstalkerRuntime = await evaluate(`({
    vineActive: document.querySelector('.dot-monitor-item[data-dot-id="bloodseekerVines"]').classList.contains("is-active"),
    vineCoverage: document.querySelector('.dot-monitor-item[data-dot-id="bloodseekerVines"] .dot-coverage').textContent,
    combatLog: document.querySelector("#combat-log-list").innerText
  })`);
  assert.equal(wildstalkerRuntime.vineActive, true);
  assert.equal(wildstalkerRuntime.vineCoverage, "1/1");
  assert.match(wildstalkerRuntime.combatLog, /血棘藤蔓/);
  await press("Backspace", "Backspace");

  await evaluate(`(() => {
    const select = document.querySelector("#build-select");
    select.value = "simcMid1Equipped";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitForIconLoads();
  const equippedCatalog = await evaluate(`({
    buildValue: document.querySelector("#build-select").value,
    puzzleAction: Boolean(document.querySelector('.skill-button[data-skill-id="algetharPuzzleBox"]')),
    arcanoweaveIcon: document.querySelector('.buff-card[data-buff="arcanoweaveInsight"] .wow-icon-image')?.dataset.iconFileId,
    acuityIcon: document.querySelector('.buff-card[data-buff="mightOfTheVoid"] .wow-icon-image')?.dataset.iconFileId,
    capybaraIcon: document.querySelector('.buff-card[data-buff="blessingOfTheCapybara"] .wow-icon-image')?.dataset.iconFileId,
    akilzonIcon: document.querySelector('.buff-card[data-buff="akilzonsCryOfVictory"] .wow-icon-image')?.dataset.iconFileId,
    brokenIcons: [...document.querySelectorAll(".wow-icon-image")].filter((image) => !image.complete || image.naturalWidth !== 56 || image.naturalHeight !== 56).length
  })`);
  assert.equal(equippedCatalog.buildValue, "simcMid1Equipped");
  assert.equal(equippedCatalog.puzzleAction, true);
  assert.equal(equippedCatalog.arcanoweaveIcon, "inv_elemental_primal_mana");
  assert.equal(equippedCatalog.acuityIcon, "ui_profession_enchanting");
  assert.equal(equippedCatalog.capybaraIcon, "inv_capybara_orange");
  assert.equal(equippedCatalog.akilzonIcon, "artifactability_survivalhunter_eaglesbite");
  assert.equal(equippedCatalog.brokenIcons, 0);

  await command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await command("Page.reload", { ignoreCache: true });
  await wait(100);
  await waitForPageReady();
  const responsive = await evaluate(`({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    skillColumns: getComputedStyle(document.querySelector("#skill-bar")).gridTemplateColumns.split(" ").length
  })`);
  assert.equal(responsive.innerWidth, 390);
  assert.equal(responsive.scrollWidth, 390);
  assert.equal(responsive.skillColumns, 4);
  const mobileGeometry = await evaluate(`(() => {
    const selectors = [
      "#open-keybinds",
      "#open-simc-import",
      "#build-select",
      "#target-count-control button",
      "#duration-presets button",
      "#custom-duration",
      "#start-pause",
      "#restart",
      "#open-aura-monitor",
      ".target-tab",
      ".skill-button"
    ];
    const controls = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const visible = controls.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    const geometry = visible.map((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
        Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
      );
      return {
        selector: element.id ? "#" + element.id : element.className,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        horizontallyClipped: rect.left < -0.5 || rect.right > window.innerWidth + 0.5,
        centerHit: rect.bottom < 0 || rect.top > window.innerHeight
          ? true
          : hit === element || element.contains(hit)
      };
    });
    const resource = document.querySelector(".resource-bars").getBoundingClientRect();
    const monitor = document.querySelector(".monitor-stack").getBoundingClientRect();
    const aura = document.querySelector(".aura-monitor-row").getBoundingClientRect();
    const cooldown = document.querySelector(".cooldown-monitor-row").getBoundingClientRect();
    const dot = document.querySelector(".dot-monitor-row").getBoundingClientRect();
    return {
      clipped: geometry.filter((item) => item.horizontallyClipped),
      missedCenters: geometry.filter((item) => !item.centerHit),
      undersizedPrimaryControls: geometry.filter((item) => item.height < 31.5),
      resourceWidth: resource.width,
      monitorWidth: monitor.width,
      rowsSeparated: aura.bottom <= cooldown.top && cooldown.bottom <= dot.top
    };
  })()`);
  assert.deepEqual(mobileGeometry.clipped, [], "移动端主要控件不得横向裁切");
  assert.deepEqual(mobileGeometry.missedCenters, [], "移动端主要控件中心点必须命中自身");
  assert.deepEqual(mobileGeometry.undersizedPrimaryControls, [], "移动端主要触控控件高度不得小于 32px");
  assert.equal(mobileGeometry.resourceWidth, mobileGeometry.monitorWidth, "移动端资源条和监控区必须同宽");
  assert.equal(mobileGeometry.rowsSeparated, true, "移动端增益、技能冷却与 DoT 必须按行隔离");
  await clickAt('[data-duration-seconds="30"]');
  assert.equal(await evaluate(`document.querySelector("#session-duration-total").textContent`), "/ 00:30", "移动端必须能够修改训练时长");
  await clickAt("#open-keybinds");
  assert.equal(await evaluate(`document.querySelector("#keybind-dialog").open`), true, "移动端必须能够打开键位配置");
  await evaluate(`document.querySelector("#keybind-dialog").close()`);
  await clickAt("#open-simc-import");
  const mobileSimcImport = await evaluate(`({
    open: document.querySelector("#simc-import-dialog").open,
    hasSavedProfile: document.querySelector("#simc-profile-input").value.includes("talents="),
    applyHeight: document.querySelector("#apply-simc-import").getBoundingClientRect().height
  })`);
  assert.equal(mobileSimcImport.open, true, "移动端必须能够打开 SimC 导入器");
  assert.equal(mobileSimcImport.hasSavedProfile, true, "移动端必须读取浏览器中已保存的 SimC Profile");
  assert(mobileSimcImport.applyHeight >= 31.5, "移动端 SimC 导入按钮高度不得小于 32px");
  await evaluate(`document.querySelector("#simc-import-dialog").close()`);
  const fallbackDialog = await evaluate(`(() => {
    const dialog = document.querySelector("#simc-import-dialog");
    Object.defineProperty(dialog, "showModal", { configurable: true, value: undefined });
    Object.defineProperty(dialog, "close", { configurable: true, value: undefined });
    document.querySelector("#open-simc-import").click();
    const rect = dialog.getBoundingClientRect();
    const opened = {
      hasOpenAttribute: dialog.hasAttribute("open"),
      fallbackClass: dialog.classList.contains("is-fallback-open"),
      bodyLocked: document.body.classList.contains("has-fallback-dialog"),
      centerDeltaX: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      centerDeltaY: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
    };
    dialog.querySelector("[data-dialog-close]").click();
    const closed = {
      hasOpenAttribute: dialog.hasAttribute("open"),
      fallbackClass: dialog.classList.contains("is-fallback-open"),
      bodyLocked: document.body.classList.contains("has-fallback-dialog"),
    };
    delete dialog.showModal;
    delete dialog.close;
    return { opened, closed };
  })()`);
  assert.equal(fallbackDialog.opened.hasOpenAttribute, true, "无 showModal 的 WebView 必须设置 open 属性");
  assert.equal(fallbackDialog.opened.fallbackClass, true, "无 showModal 的 WebView 必须启用兼容弹窗样式");
  assert.equal(fallbackDialog.opened.bodyLocked, true, "兼容弹窗打开时必须锁定背景滚动");
  assert(fallbackDialog.opened.centerDeltaX < 2 && fallbackDialog.opened.centerDeltaY < 2, "兼容弹窗必须在 H5 视口居中");
  assert.deepEqual(fallbackDialog.closed, { hasOpenAttribute: false, fallbackClass: false, bodyLocked: false });
  await clickAt("#open-aura-monitor");
  assert.equal(await evaluate(`document.querySelector("#aura-monitor-dialog").open`), true, "移动端必须能够打开增益监控选择器");
  await clickAt("#clear-aura-monitors");
  await clickAt('.aura-monitor-choice input[type="checkbox"]');
  const mobileAuraSelection = await evaluate(`({
    checked: document.querySelector('.aura-monitor-choice input[type="checkbox"]').checked,
    selectedCount: document.querySelectorAll(".aura-monitor-item").length,
    brokenIcons: [...document.querySelectorAll(".aura-monitor-item .wow-icon-image")].filter((image) => !image.complete || image.naturalWidth !== 56 || image.naturalHeight !== 56).length
  })`);
  assert.equal(mobileAuraSelection.checked, true, "移动端必须能够勾选增益监控");
  assert.equal(mobileAuraSelection.selectedCount, 1, "移动端选择的增益必须立即进入独立监控行");
  assert.equal(mobileAuraSelection.brokenIcons, 0, "移动端已选增益必须使用有效技能图标");
  await evaluate(`document.querySelector("#aura-monitor-dialog").close()`);
  await clickAt("#start-pause");
  const mobileStarted = await evaluate(`document.querySelector("#session-status").classList.contains("is-running")`);
  assert.equal(mobileStarted, true, "移动端点击开始训练必须生效");
  const skillTap = await clickAt('.skill-button[data-skill-id="tigersFury"] .wow-icon-image');
  await wait(80);
  const mobileCast = await evaluate(`({
    casts: document.querySelectorAll(".sequence-entry").length,
    feedbackVisible: !document.querySelector("#feedback").classList.contains("visually-hidden"),
    feedback: document.querySelector("#feedback").textContent
  })`);
  assert.equal(skillTap.hitSkillId, "tigersFury", "点击技能图标时命中目标必须是所属技能按钮");
  assert.equal(mobileCast.casts, 1, "移动端点击技能图标必须施放技能");
  assert.equal(mobileCast.feedbackVisible, true, "移动端必须展示施法或失败原因反馈");
  await clickAt('[data-target-count="3"]');
  await wait(40);
  const mobileTargets = await evaluate(`document.querySelectorAll(".target-tab").length`);
  assert.equal(mobileTargets, 3, "移动端点击目标数量必须切换木桩数量");
  await clickAt('.target-tab[data-target-index="1"]');
  const mobileActiveTarget = await evaluate(`document.querySelector(".target-tab.is-active").dataset.targetIndex`);
  assert.equal(mobileActiveTarget, "1", "移动端点击目标标签必须切换当前目标");
  await command("Emulation.clearDeviceMetricsOverride");

  console.log(JSON.stringify({
    ok: true,
    title: initial.title,
    successfulCasts: sideCast.after,
    rebound: "斜掠 → Z",
    shortcuts: { space: "开始/暂停", backspace: "重置" },
    pointingBindings,
    sideNavigationSuppression: sideCast,
    targetCounts,
    switchedBuild,
    responsive,
    mobileGeometry,
    mobileTouch: {
      casts: mobileCast.casts,
      targets: mobileTargets,
      activeTarget: mobileActiveTarget,
      duration: 30,
      selectedAuras: mobileAuraSelection.selectedCount
    },
    simcImport: {
      options: simcImport.buildOptions,
      unsupportedSummary: simcImport.statusText,
      invalidProfilePreserved: failedImport.persistedProfile === failedImport.previousProfile,
      mobile: mobileSimcImport,
      fallbackDialog,
      legacyMigration,
    },
    equippedCatalog,
  }, null, 2));
} finally {
  socket.close();
}
