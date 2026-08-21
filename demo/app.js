import { buildInputFromFixture, normalizeBuildInput } from "./core/build-input.js";
import {
  IMPORTED_BUILD_KEY,
  clearImportedProfile,
  loadAndMigrateImportedProfile,
  loadSelectedBuildKey,
  saveImportedProfile,
  saveSelectedBuildKey as saveNamespacedSelectedBuildKey,
} from "./core/profile-cache.js";
import { checkForReleaseUpdate } from "./core/release-update.js";
import {
  bindingFromMouseButton,
  bindingFromWheelDelta,
  displayInputBinding as displayKeyCode,
  isSideMouseBinding,
} from "./core/input-bindings.js";
import { BUILD_FIXTURES } from "./data/12.1/build-fixtures.js";
import { FeralTrainerController } from "./trainer-controller.js";
import { versionedAssetUrl } from "./release.generated.js";

const STORAGE_KEY = "ashamane-lab-keybinds-v2";
const AURA_MONITOR_STORAGE_KEY = "ashamane-lab-aura-monitor-selections-v1";
const DURATION_STORAGE_KEY = "ashamane-lab-session-duration-v1";
const MAX_SIMC_PROFILE_BYTES = 512 * 1024;
const MIN_DURATION_SECONDS = 15;
const MAX_DURATION_SECONDS = 600;
const ICON_RETRY_DELAYS_MS = [250, 1000, 2500];
const WHEEL_TRIGGER_INTERVAL_MS = 250;
const WHEEL_CAPTURE_SUPPRESSION_MS = 500;
const controller = new FeralTrainerController();
const fixtureEntries = Object.entries(BUILD_FIXTURES);

const elements = {
  buildSelect: document.querySelector("#build-select"),
  openSimcImport: document.querySelector("#open-simc-import"),
  simcImportDialog: document.querySelector("#simc-import-dialog"),
  simcProfileInput: document.querySelector("#simc-profile-input"),
  simcImportStatus: document.querySelector("#simc-import-status"),
  simcImportHint: document.querySelector("#simc-import-hint"),
  applySimcImport: document.querySelector("#apply-simc-import"),
  clearSimcImport: document.querySelector("#clear-simc-import"),
  targetCountControl: document.querySelector("#target-count-control"),
  durationPresets: document.querySelector("#duration-presets"),
  customDuration: document.querySelector("#custom-duration"),
  targetList: document.querySelector("#target-list"),
  sessionTime: document.querySelector("#session-time"),
  sessionDurationTotal: document.querySelector("#session-duration-total"),
  sessionProgress: document.querySelector("#session-progress-fill"),
  sessionStatus: document.querySelector("#session-status"),
  sessionStatusCopy: document.querySelector("#session-status .status-copy"),
  startPause: document.querySelector("#start-pause"),
  restart: document.querySelector("#restart"),
  recommendationIcon: document.querySelector("#recommendation-icon"),
  recommendationName: document.querySelector("#recommendation-name"),
  recommendationTarget: document.querySelector("#recommendation-target"),
  recommendationReason: document.querySelector("#recommendation-reason"),
  recommendationKey: document.querySelector("#recommendation-key"),
  energyValue: document.querySelector("#energy-value"),
  energyMax: document.querySelector("#energy-max"),
  energyFill: document.querySelector("#energy-fill"),
  channelBar: document.querySelector("#channel-bar"),
  channelFill: document.querySelector("#channel-fill"),
  channelName: document.querySelector("#channel-name"),
  channelTime: document.querySelector("#channel-time"),
  comboValue: document.querySelector("#combo-value"),
  comboPoints: [...document.querySelectorAll("#combo-points span")],
  buffRow: document.querySelector("#buff-row"),
  buffFilter: document.querySelector("#buff-filter"),
  buffFilterCount: document.querySelector("#buff-filter-count"),
  feedback: document.querySelector("#feedback"),
  actionFeedback: document.querySelector("#action-feedback"),
  selectedAuraStrip: document.querySelector("#selected-aura-strip"),
  cooldownStrip: document.querySelector("#cooldown-strip"),
  dotMonitorStrip: document.querySelector("#dot-monitor-strip"),
  skillBar: document.querySelector("#skill-bar"),
  metricAccuracy: document.querySelector("#metric-accuracy"),
  metricPerfect: document.querySelector("#metric-perfect"),
  metricStreak: document.querySelector("#metric-streak"),
  metricBest: document.querySelector("#metric-best"),
  metricApm: document.querySelector("#metric-apm"),
  metricCasts: document.querySelector("#metric-casts"),
  sequenceList: document.querySelector("#sequence-list"),
  sequenceCount: document.querySelector("#sequence-count"),
  copySequence: document.querySelector("#copy-sequence"),
  clearSequence: document.querySelector("#clear-sequence"),
  combatLogList: document.querySelector("#combat-log-list"),
  combatLogCount: document.querySelector("#combat-log-count"),
  openKeybinds: document.querySelector("#open-keybinds"),
  keybindDialog: document.querySelector("#keybind-dialog"),
  keybindList: document.querySelector("#keybind-list"),
  keybindHint: document.querySelector("#keybind-hint"),
  resetKeybinds: document.querySelector("#reset-keybinds"),
  openAuraMonitor: document.querySelector("#open-aura-monitor"),
  auraMonitorDialog: document.querySelector("#aura-monitor-dialog"),
  auraMonitorFilter: document.querySelector("#aura-monitor-filter"),
  auraMonitorFilterCount: document.querySelector("#aura-monitor-filter-count"),
  auraMonitorList: document.querySelector("#aura-monitor-list"),
  auraMonitorHint: document.querySelector("#aura-monitor-hint"),
  clearAuraMonitors: document.querySelector("#clear-aura-monitors"),
  footerProfile: document.querySelector("#footer-profile"),
  releaseUpdate: document.querySelector("#release-update"),
  toast: document.querySelector("#toast"),
};

const importedCacheResult = loadAndMigrateImportedProfile();
let importedBuildInput = importedCacheResult.profileText
  ? createImportedBuildInput(importedCacheResult.profileText)
  : null;
let importedResolvedProfile = importedCacheResult.resolvedProfile ?? null;
let selectedBuildKey = loadStoredSelectedBuildKey();
let selectedTargetCount = 1;
let selectedDurationSeconds = loadStoredDurationSeconds();
let snapshot = controller.getSnapshot();
let keybinds = loadStoredKeybinds();
let auraMonitorSelections = loadStoredAuraMonitorSelections();
let listeningSkillId = null;
let isAdvancing = false;
let hasStarted = false;
let sequenceStartIndex = 0;
let lastTargetSignature = "";
let lastSequenceSignature = "";
let lastLogSignature = "";
let toastTimer = null;
let wheelInputBlockedUntil = 0;
let feedback = { type: "info", message: "点击“开始训练”，随后使用键位或技能按钮施法。" };
const skillButtons = new Map();
const cooldownItems = new Map();
const dotMonitorItems = new Map();
const auraMonitorItems = new Map();

function loadStoredKeybinds() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function saveKeybinds() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keybinds));
}

function loadStoredAuraMonitorSelections() {
  try {
    const stored = JSON.parse(localStorage.getItem(AURA_MONITOR_STORAGE_KEY));
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).flatMap(([profileId, auraIds]) => {
      if (!Array.isArray(auraIds)) return [];
      return [[profileId, [...new Set(auraIds.filter((auraId) => typeof auraId === "string"))]]];
    }));
  } catch {
    return {};
  }
}

function saveAuraMonitorSelections() {
  localStorage.setItem(AURA_MONITOR_STORAGE_KEY, JSON.stringify(auraMonitorSelections));
}

function loadStoredDurationSeconds() {
  try {
    const stored = Number(localStorage.getItem(DURATION_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_DURATION_SECONDS && stored <= MAX_DURATION_SECONDS
      ? Math.round(stored)
      : 60;
  } catch {
    return 60;
  }
}

function saveDurationSeconds() {
  localStorage.setItem(DURATION_STORAGE_KEY, String(selectedDurationSeconds));
}

function createImportedBuildInput(profileText) {
  return normalizeBuildInput({
    kind: "simc-profile",
    id: "simc-imported-feral-profile",
    profileText,
    source: "browser-simc-import",
  });
}

function loadStoredSelectedBuildKey() {
  const stored = loadSelectedBuildKey();
  if (stored === IMPORTED_BUILD_KEY && importedBuildInput) return stored;
  if (stored && BUILD_FIXTURES[stored]) return stored;
  return fixtureEntries[0][0];
}

function saveSelectedBuildKey() {
  saveNamespacedSelectedBuildKey(selectedBuildKey);
}

function currentActions() {
  return snapshot.catalog.actions;
}

function actionById(skillId) {
  return currentActions().find((action) => action.id === skillId) ?? null;
}

function catalogActionById(skillId) {
  return actionById(skillId) ?? snapshot.catalog.internalActions.find((action) => action.id === skillId) ?? null;
}

function currentAuraSelectionKey() {
  return snapshot.profile.id;
}

function currentAuraDefinitions() {
  return snapshot.catalog.tracked.auras;
}

function selectedAuraIds() {
  return auraMonitorSelections[currentAuraSelectionKey()] ?? [];
}

function setSelectedAuraIds(auraIds) {
  const availableAuraIds = new Set(currentAuraDefinitions().map((aura) => aura.id));
  const validAuraIds = [...new Set(auraIds)].filter((auraId) => availableAuraIds.has(auraId));
  const profileKey = currentAuraSelectionKey();
  if (validAuraIds.length) auraMonitorSelections[profileKey] = validAuraIds;
  else delete auraMonitorSelections[profileKey];
  saveAuraMonitorSelections();
}

function selectedAuraDefinitions() {
  const definitionsById = new Map(currentAuraDefinitions().map((aura) => [aura.id, aura]));
  const selectedIds = selectedAuraIds();
  const validIds = selectedIds.filter((auraId) => definitionsById.has(auraId));
  if (validIds.length !== selectedIds.length) setSelectedAuraIds(validIds);
  return validIds.map((auraId) => definitionsById.get(auraId));
}

function syncDefaultKeybinds() {
  for (const action of currentActions()) {
    if (!(action.id in keybinds)) keybinds[action.id] = action.defaultCode ?? "";
  }
  saveKeybinds();
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(seconds / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${tenths}`;
}

function formatDuration(milliseconds) {
  return milliseconds > 50 ? `${(milliseconds / 1000).toFixed(1)} 秒` : "未激活";
}

function formatClockDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function installIconLoadRecovery() {
  document.addEventListener("load", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("wow-icon-image")) return;
    image.dataset.iconLoadStatus = "loaded";
  }, true);
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("wow-icon-image")) return;
    const retryCount = Number(image.dataset.iconRetryCount ?? 0);
    if (retryCount >= ICON_RETRY_DELAYS_MS.length) {
      image.dataset.iconLoadStatus = "failed";
      return;
    }
    const nextRetryCount = retryCount + 1;
    image.dataset.iconRetryCount = String(nextRetryCount);
    image.dataset.iconLoadStatus = "retrying";
    setTimeout(() => {
      if (!image.isConnected) return;
      const retryUrl = new URL(image.dataset.iconSource, document.baseURI);
      retryUrl.searchParams.set("retry", String(nextRetryCount));
      image.src = retryUrl.href;
    }, ICON_RETRY_DELAYS_MS[retryCount]);
  }, true);
}

function iconMarkup(definition) {
  const icon = definition?.icon;
  if (!icon?.path) return '<span class="wow-icon-missing" aria-hidden="true"></span>';
  const iconKey = icon.fileDataId ?? icon.iconName;
  const iconSource = versionedAssetUrl(icon.path);
  return `<img class="wow-icon-image" src="${iconSource}" data-icon-source="${iconSource}" data-icon-load-status="pending" data-icon-file-id="${iconKey}" alt="" draggable="false" />`;
}

function getSkillForCode(code) {
  return Object.entries(keybinds).find(([, boundCode]) => boundCode === code)?.[0] ?? null;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

function isDialogOpen(dialog) {
  return dialog.hasAttribute("open");
}

function syncFallbackDialogState() {
  document.body.classList.toggle("has-fallback-dialog", Boolean(document.querySelector("dialog.is-fallback-open[open]")));
}

function openModalDialog(dialog) {
  if (isDialogOpen(dialog)) return;
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
      return;
    } catch {
      // Embedded WebViews can expose showModal while failing to create a modal top layer.
    }
  }
  dialog.setAttribute("open", "");
  dialog.classList.add("is-fallback-open");
  syncFallbackDialogState();
}

function closeModalDialog(dialog) {
  if (!isDialogOpen(dialog)) return;
  if (!dialog.classList.contains("is-fallback-open") && typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
  dialog.classList.remove("is-fallback-open");
  syncFallbackDialogState();
  dialog.dispatchEvent(new Event("close"));
}

function createBuildOptions() {
  const options = fixtureEntries.map(([key, fixture]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = fixture.label;
    return option;
  });
  if (importedBuildInput) {
    const option = document.createElement("option");
    option.value = IMPORTED_BUILD_KEY;
    option.textContent = `已导入 · ${importedBuildInput.label}`;
    options.push(option);
  }
  if (selectedBuildKey === IMPORTED_BUILD_KEY && !importedBuildInput) selectedBuildKey = fixtureEntries[0][0];
  elements.buildSelect.replaceChildren(...options);
  elements.buildSelect.value = selectedBuildKey;
}

function currentBuildInput() {
  if (selectedBuildKey === IMPORTED_BUILD_KEY) {
    if (!importedBuildInput) throw new Error("已导入的 SimC Profile 不存在，请重新导入。");
    return importedBuildInput;
  }
  const fixture = BUILD_FIXTURES[selectedBuildKey];
  if (!fixture) throw new Error(`未知构筑：${selectedBuildKey}`);
  return buildInputFromFixture(fixture);
}

function profileByteLength(profileText) {
  return new TextEncoder().encode(profileText).byteLength;
}

function validateSimcProfile(profileText) {
  if (!profileText.trim()) throw new Error("请先粘贴 SimC Profile。");
  const byteLength = profileByteLength(profileText);
  if (byteLength > MAX_SIMC_PROFILE_BYTES) {
    throw new Error(`Profile 大小为 ${Math.ceil(byteLength / 1024)} KiB，超过 512 KiB 上限。`);
  }
  const buildInput = createImportedBuildInput(profileText);
  const previewController = new FeralTrainerController({ defaultBuildInput: buildInput });
  const preview = previewController.startSession({
    buildInput,
    targetCount: selectedTargetCount,
    durationMs: selectedDurationSeconds * 1000,
    procMode: "seeded",
    seed: 1210001,
  });
  return { buildInput, preview, resolvedProfile: previewController.profile };
}

function renderSimcImportStatus({ type = "idle", message, snapshot: reportSnapshot = null } = {}) {
  elements.simcImportStatus.className = `simc-import-status is-${type}`;
  elements.simcImportStatus.replaceChildren();
  const headline = document.createElement("strong");
  headline.textContent = message ?? "尚未解析 Profile。";
  elements.simcImportStatus.append(headline);
  if (!reportSnapshot) return;

  const summary = document.createElement("p");
  summary.textContent = `${reportSnapshot.catalog.actions.length} 个可用技能 · ${reportSnapshot.profile.unsupportedFieldCount} 个未应用字段 · ${reportSnapshot.profile.unsupportedEffectCount} 个未实现效果 · ${reportSnapshot.profile.unsupportedAplRuleCount} 条未支持 APL`;
  elements.simcImportStatus.append(summary);

  const unsupported = [
    ...reportSnapshot.catalog.unsupportedFields.map((field) => ({
      label: `第 ${field.lineNumber ?? "?"} 行 · ${field.key ?? field.fieldKind}`,
      reason: field.reason,
    })),
    ...reportSnapshot.catalog.unsupportedEffects.map((effect) => ({
      label: effect.sourceName ?? effect.effectId,
      reason: effect.reason,
    })),
    ...reportSnapshot.catalog.unsupportedAplRules.map((rule) => ({
      label: `APL 第 ${rule.lineNumber ?? "?"} 行 · ${rule.list}/${rule.action}`,
      reason: rule.reason,
    })),
  ];
  if (!unsupported.length) return;
  const list = document.createElement("ul");
  for (const entry of unsupported.slice(0, 8)) {
    const item = document.createElement("li");
    item.textContent = `${entry.label}：${entry.reason}`;
    list.append(item);
  }
  if (unsupported.length > 8) {
    const item = document.createElement("li");
    item.textContent = `另有 ${unsupported.length - 8} 项，均已保留在结构化结果中。`;
    list.append(item);
  }
  elements.simcImportStatus.append(list);
}

function openSimcImportDialog() {
  elements.simcProfileInput.value = importedBuildInput?.sourceProfileText ?? "";
  elements.simcImportHint.textContent = importedBuildInput
    ? "已保存一个导入构筑；重新解析成功后会替换它。"
    : "成功导入后会保存在当前浏览器，并作为独立构筑出现在下拉框中。";
  if (importedBuildInput) {
    try {
      const { preview } = validateSimcProfile(importedBuildInput.sourceProfileText);
      renderSimcImportStatus({ type: "success", message: `${preview.profile.label} 已保存`, snapshot: preview });
    } catch (error) {
      renderSimcImportStatus({ type: "error", message: `已保存 Profile 无法解析：${error.message}` });
    }
  } else {
    renderSimcImportStatus();
  }
  openModalDialog(elements.simcImportDialog);
  elements.simcProfileInput.focus();
}

function applySimcImport() {
  const profileText = elements.simcProfileInput.value;
  try {
    const { buildInput, preview, resolvedProfile } = validateSimcProfile(profileText);
    saveImportedProfile({ profileText, resolvedProfile });
    importedBuildInput = buildInput;
    importedResolvedProfile = resolvedProfile;
    selectedBuildKey = IMPORTED_BUILD_KEY;
    createBuildOptions();
    prepareSession();
    renderSimcImportStatus({ type: "success", message: `${snapshot.profile.label} 已解析并启用`, snapshot });
    elements.simcImportHint.textContent = "导入已保存在当前浏览器。关闭窗口即可开始训练。";
    showToast(`已导入 ${preview.profile.label}`);
  } catch (error) {
    renderSimcImportStatus({ type: "error", message: `导入失败：${error.message}` });
    elements.simcImportHint.textContent = "当前训练构筑未改变。请修正 Profile 后重试。";
  }
}

function clearSimcImport() {
  try {
    clearImportedProfile();
    importedBuildInput = null;
    importedResolvedProfile = null;
    elements.simcProfileInput.value = "";
    if (selectedBuildKey === IMPORTED_BUILD_KEY) {
      selectedBuildKey = fixtureEntries[0][0];
      saveSelectedBuildKey();
      createBuildOptions();
      prepareSession();
    } else {
      createBuildOptions();
    }
    renderSimcImportStatus({ type: "idle", message: "已清除浏览器中保存的 SimC Profile。" });
    elements.simcImportHint.textContent = "当前没有已保存的导入构筑。";
  } catch (error) {
    renderSimcImportStatus({ type: "error", message: `清除失败：${error.message}` });
  }
}

function prepareSession({ preserveStarted = false } = {}) {
  const buildInput = currentBuildInput();
  snapshot = controller.startSession({
    ...(selectedBuildKey === IMPORTED_BUILD_KEY && importedResolvedProfile
      ? { resolvedProfile: importedResolvedProfile }
      : { buildInput }),
    targetCount: selectedTargetCount,
    durationMs: selectedDurationSeconds * 1000,
    procMode: "seeded",
    seed: 1210001,
  });
  hasStarted = preserveStarted;
  isAdvancing = preserveStarted;
  sequenceStartIndex = 0;
  feedback = {
    type: "info",
    message: `${snapshot.profile.label} 已加载；${snapshot.catalog.actions.length} 个可用技能，${snapshot.profile.unsupportedFieldCount} 个字段、${snapshot.profile.unsupportedEffectCount} 项效果和 ${snapshot.profile.unsupportedAplRuleCount} 条 APL 已结构化标记为未支持。`,
  };
  syncDefaultKeybinds();
  rebuildActionSurfaces();
  lastTargetSignature = "";
  lastSequenceSignature = "";
  lastLogSignature = "";
  render();
}

function applyProfileCacheNotice() {
  if (importedCacheResult.status === "migrated") {
    const unsupported = importedCacheResult.unsupportedDiff;
    const detail = unsupported
      ? `未支持字段 ${unsupported.unsupportedFields.leftCount}→${unsupported.unsupportedFields.rightCount}、效果 ${unsupported.unsupportedEffects.leftCount}→${unsupported.unsupportedEffects.rightCount}、APL ${unsupported.unsupportedAplRules.leftCount}→${unsupported.unsupportedAplRules.rightCount}`
      : `当前未支持字段 ${importedResolvedProfile?.unsupportedFields.length ?? 0}、效果 ${importedResolvedProfile?.unsupportedEffects.length ?? 0}、APL ${importedResolvedProfile?.unsupportedAplRules.length ?? 0}`;
    const rollback = importedCacheResult.retainedRollback
      ? "旧缓存保留为回滚点。"
      : "原记录仅在解析和写入均成功后更新。";
    feedback = { type: "success", message: `已在新版本中安全重解析已保存 Profile；${detail}。${rollback}` };
    render();
    showToast("Profile 已迁移并重解析");
  } else if (importedCacheResult.status === "migration-failed") {
    feedback = importedResolvedProfile
      ? { type: "warning", message: `Profile 重解析失败，已继续使用兼容的旧 ResolvedProfile；旧缓存未覆盖。${importedCacheResult.error?.message ?? ""}` }
      : { type: "warning", message: `Profile 重解析失败，旧缓存未覆盖；当前已回退到首个测试构筑。${importedCacheResult.error?.message ?? ""}` };
    render();
    showToast("Profile 迁移失败，已安全回退");
  }
}

let releaseCheckInFlight = false;
let lastReleaseCheckAt = 0;

async function discoverReleaseUpdate() {
  if (releaseCheckInFlight || Date.now() - lastReleaseCheckAt < 60_000) return;
  releaseCheckInFlight = true;
  lastReleaseCheckAt = Date.now();
  try {
    const result = await checkForReleaseUpdate();
    if (result.status !== "update-available") return;
    elements.releaseUpdate.hidden = false;
    elements.releaseUpdate.textContent = `新版本 ${result.remoteReleaseId} 可用`;
    elements.releaseUpdate.title = `${result.changedResources.length} 个资源变化；点击刷新后迁移 Profile`;
  } catch (error) {
    console.warn("Release discovery failed; the active training session is unchanged.", error);
  } finally {
    releaseCheckInFlight = false;
  }
}

function rebuildActionSurfaces() {
  skillButtons.clear();
  cooldownItems.clear();
  dotMonitorItems.clear();
  auraMonitorItems.clear();
  elements.skillBar.innerHTML = "";
  elements.selectedAuraStrip.innerHTML = "";
  elements.cooldownStrip.innerHTML = "";
  elements.dotMonitorStrip.innerHTML = "";

  for (const action of currentActions()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skill-button";
    button.dataset.skillId = action.id;
    button.title = `${action.name} · ${action.simcName ?? action.id}`;
    button.innerHTML = `
      <span class="skill-key"></span>
      <span class="skill-glyph">${iconMarkup(action)}</span>
      <span class="cooldown-sweep" aria-hidden="true"></span>
      <span class="cooldown-number" aria-hidden="true"></span>
      <span class="skill-name">${action.name}</span>
      <span class="skill-meta"></span>
    `;
    bindSkillButton(button, action.id);
    skillButtons.set(action.id, button);
    elements.skillBar.append(button);

    if (action.trackingGroup?.includes("cooldown")) {
      const item = document.createElement("span");
      item.className = "cooldown-item is-ready";
      item.dataset.skillId = action.id;
      item.title = action.name;
      item.innerHTML = `
        <span class="skill-glyph">${iconMarkup(action)}</span>
        <span class="cooldown-sweep" aria-hidden="true"></span>
        <span class="cooldown-number" aria-hidden="true"></span>
        <small>${displayKeyCode(keybinds[action.id])}</small>
      `;
      cooldownItems.set(action.id, item);
      elements.cooldownStrip.append(item);
    }
  }
  const desktopSlotCount = 16;
  for (let index = currentActions().length; index < desktopSlotCount; index += 1) {
    const emptySlot = document.createElement("span");
    emptySlot.className = "action-slot-empty";
    emptySlot.setAttribute("aria-hidden", "true");
    elements.skillBar.append(emptySlot);
  }
  for (const dot of snapshot.catalog.tracked.dots) {
    const item = document.createElement("span");
    item.className = "dot-monitor-item is-inactive";
    item.dataset.dotId = dot.id;
    item.title = dot.name ?? dot.id;
    item.innerHTML = `
      <span class="skill-glyph">${iconMarkup(dot)}</span>
      <span class="cooldown-sweep" aria-hidden="true"></span>
      <span class="cooldown-number" aria-hidden="true"></span>
      <small class="dot-coverage">0/${snapshot.session.targetCount}</small>
    `;
    dotMonitorItems.set(dot.id, item);
    elements.dotMonitorStrip.append(item);
  }
  createKeybindRows();
  createBuffCards();
  createAuraMonitorItems();
  createAuraMonitorRows();
}

function bindSkillButton(button, skillId) {
  let touchStart = null;
  let suppressNextClick = false;
  let suppressClickTimer = null;
  const activate = (source) => {
    button.blur();
    castSkill(skillId, source);
  };

  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    touchStart = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
  });
  button.addEventListener("pointercancel", () => {
    touchStart = null;
  });
  button.addEventListener("pointerup", (event) => {
    if (!touchStart || event.pointerType !== "touch" || event.pointerId !== touchStart.pointerId) return;
    const moved = Math.hypot(event.clientX - touchStart.clientX, event.clientY - touchStart.clientY) > 12;
    touchStart = null;
    if (moved) return;
    event.preventDefault();
    suppressNextClick = true;
    clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => {
      suppressNextClick = false;
    }, 800);
    activate("touch");
  });
  button.addEventListener("click", (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      clearTimeout(suppressClickTimer);
      event.preventDefault();
      return;
    }
    activate("mouse");
  });
}

function createKeybindRows() {
  elements.keybindList.innerHTML = "";
  for (const action of currentActions()) {
    const row = document.createElement("div");
    row.className = "keybind-row";
    row.dataset.skillId = action.id;
    row.innerHTML = `
      <span class="skill-glyph">${iconMarkup(action)}</span>
      <div class="keybind-name"><strong>${action.name}</strong><small>${action.simcName ?? action.id}</small></div>
      <button type="button" class="keybind-button" data-bind-skill="${action.id}"></button>
    `;
    row.querySelector(".keybind-button").addEventListener("click", () => beginListening(action.id));
    elements.keybindList.append(row);
  }
  renderKeybinds();
}

function createBuffCards() {
  elements.buffRow.innerHTML = "";
  for (const aura of snapshot.catalog.tracked.auras) {
    const name = aura.name ?? aura.id;
    const card = document.createElement("div");
    card.className = "buff-card";
    card.dataset.buff = aura.id;
    card.dataset.buffName = name;
    card.dataset.spellId = String(aura.spellId ?? "");
    card.title = `${name}${aura.spellId ? ` · 法术 ID ${aura.spellId}` : ""}`;
    card.innerHTML = `
      <span class="buff-orb">${iconMarkup(aura)}</span>
      <div><strong>${name}</strong><span class="buff-time">未激活</span></div>
    `;
    elements.buffRow.append(card);
  }
  applyBuffFilter();
}

function createAuraMonitorItems() {
  auraMonitorItems.clear();
  elements.selectedAuraStrip.innerHTML = "";
  const selectedAuras = selectedAuraDefinitions();
  if (!selectedAuras.length) {
    const emptyState = document.createElement("span");
    emptyState.className = "monitor-empty";
    emptyState.textContent = "未选择增益 · 点击“配置增益”添加";
    elements.selectedAuraStrip.append(emptyState);
    return;
  }

  for (const aura of selectedAuras) {
    const item = document.createElement("span");
    item.className = "aura-monitor-item is-inactive";
    item.dataset.auraId = aura.id;
    item.title = aura.name ?? aura.id;
    item.innerHTML = `
      <span class="skill-glyph">${iconMarkup(aura)}</span>
      <span class="cooldown-sweep" aria-hidden="true"></span>
      <span class="cooldown-number" aria-hidden="true"></span>
      <small class="aura-stack" aria-hidden="true"></small>
    `;
    auraMonitorItems.set(aura.id, item);
    elements.selectedAuraStrip.append(item);
  }
}

function createAuraMonitorRows() {
  elements.auraMonitorList.innerHTML = "";
  const selectedIds = new Set(selectedAuraIds());
  for (const aura of currentAuraDefinitions()) {
    const name = aura.name ?? aura.id;
    const row = document.createElement("label");
    row.className = "aura-monitor-choice";
    row.dataset.auraMonitorId = aura.id;
    row.dataset.auraName = name;
    row.dataset.spellId = String(aura.spellId ?? "");
    row.innerHTML = `
      <input type="checkbox" value="${aura.id}" ${selectedIds.has(aura.id) ? "checked" : ""} />
      <span class="skill-glyph">${iconMarkup(aura)}</span>
      <span class="aura-monitor-choice-copy"><strong>${name}</strong><small>${aura.spellId ? `法术 ID ${aura.spellId}` : aura.id}</small></span>
    `;
    elements.auraMonitorList.append(row);
  }
  applyAuraMonitorFilter();
}

function applyBuffFilter() {
  const query = elements.buffFilter.value.trim().toLocaleLowerCase();
  const cards = [...elements.buffRow.querySelectorAll(".buff-card")];
  let visibleCount = 0;
  for (const card of cards) {
    const searchable = `${card.dataset.buffName} ${card.dataset.spellId} ${card.dataset.buff}`.toLocaleLowerCase();
    const visible = !query || searchable.includes(query);
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  }
  elements.buffFilterCount.textContent = `${visibleCount} / ${cards.length}`;
}

function applyAuraMonitorFilter() {
  const query = elements.auraMonitorFilter.value.trim().toLocaleLowerCase();
  const rows = [...elements.auraMonitorList.querySelectorAll(".aura-monitor-choice")];
  let visibleCount = 0;
  for (const row of rows) {
    const searchable = `${row.dataset.auraName} ${row.dataset.spellId} ${row.dataset.auraMonitorId}`.toLocaleLowerCase();
    const visible = !query || searchable.includes(query);
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  }
  elements.auraMonitorFilterCount.textContent = `${visibleCount} / ${rows.length}`;
}

function beginListening(skillId) {
  listeningSkillId = skillId;
  elements.keybindHint.textContent = `正在设置「${actionById(skillId).name}」：请按键、鼠标侧键、滚轮按下或滚动滚轮；Delete 清除，Esc 取消。`;
  renderKeybinds();
}

function renderKeybinds() {
  for (const button of elements.keybindList.querySelectorAll(".keybind-button")) {
    const skillId = button.dataset.bindSkill;
    const listening = listeningSkillId === skillId;
    button.classList.toggle("is-listening", listening);
    button.textContent = listening ? "按新键…" : displayKeyCode(keybinds[skillId]);
  }
}

function assignListeningBinding(binding) {
  if (!listeningSkillId || !binding) return false;
  const displaced = getSkillForCode(binding);
  if (displaced && displaced !== listeningSkillId) keybinds[displaced] = "";
  const action = actionById(listeningSkillId);
  keybinds[listeningSkillId] = binding;
  listeningSkillId = null;
  elements.keybindHint.textContent = `已将 ${displayKeyCode(binding)} 绑定给「${action.name}」。`;
  saveKeybinds();
  renderKeybinds();
  renderSkills();
  return true;
}

function capturePointingBinding(event, binding) {
  if (!listeningSkillId || !binding) return false;
  event.preventDefault();
  event.stopPropagation();
  return assignListeningBinding(binding);
}

function captureKeybind(event) {
  if (!listeningSkillId) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.code === "Escape") {
    listeningSkillId = null;
    elements.keybindHint.textContent = "已取消键位修改。";
  } else if (event.code === "Space") {
    elements.keybindHint.textContent = "空格键保留用于开始/暂停训练，请按其他技能键。";
  } else if (["Backspace", "Delete"].includes(event.code)) {
    keybinds[listeningSkillId] = "";
    listeningSkillId = null;
    elements.keybindHint.textContent = "已清除键位。";
    saveKeybinds();
  } else if (!(event.metaKey || event.ctrlKey || event.altKey || event.code.startsWith("Shift"))) {
    return assignListeningBinding(event.code);
  }
  renderKeybinds();
  renderSkills();
  return true;
}

function formatBlockedReason(result, skillId) {
  if (result.blockedCode === "global-cooldown") {
    return `公共冷却 ${(snapshot.gcd.remainingMs / 1000).toFixed(1)} 秒`;
  }
  if (result.blockedCode === "channel-active") {
    const channelAction = snapshot.channel ? actionById(snapshot.channel.skillId) : null;
    const remaining = snapshot.channel ? ` ${(snapshot.channel.remainingMs / 1000).toFixed(1)} 秒` : "";
    return `${channelAction?.name ?? "持续施法"}引导中${remaining}`;
  }
  if (result.blockedCode === "cooldown") {
    const remaining = snapshot.cooldowns[skillId]?.remainingMs ?? 0;
    return remaining > 50 ? `技能冷却 ${(remaining / 1000).toFixed(1)} 秒` : result.reason;
  }
  return result.reason;
}

function flashSkillResult(button, succeeded) {
  if (!button) return;
  button.classList.remove("is-pressed", "is-cast", "is-waiting");
  button.classList.add("is-pressed", succeeded ? "is-cast" : "is-waiting");
  setTimeout(() => button?.classList.remove("is-pressed", "is-cast", "is-waiting"), succeeded ? 180 : 160);
}

function castSkill(skillId, source) {
  const action = actionById(skillId);
  const button = skillButtons.get(skillId);
  if (!hasStarted || !isAdvancing) {
    feedback = { type: "info", message: hasStarted ? "训练已暂停。" : "请先开始训练。" };
    flashSkillResult(button, false);
    renderFeedback();
    return;
  }
  const result = controller.pressAction({ skillId, targetIndex: snapshot.activeTargetIndex });
  snapshot = result.snapshot;
  feedback = result.ok
    ? { type: result.event.verdict === "perfect" ? "success" : "info", message: `${action.name}已施放 · ${result.event.verdict}` }
    : { type: "warning", message: `${action?.name ?? skillId}未施放：${formatBlockedReason(result, skillId)}` };
  flashSkillResult(button, result.ok);
  render();
}

function renderTargets() {
  const signature = `${snapshot.profile.id}:${snapshot.session.targetCount}:${snapshot.activeTargetIndex}:${snapshot.session.actionCount}:${Math.floor(snapshot.session.timestamp / 100)}`;
  if (signature === lastTargetSignature) return;
  lastTargetSignature = signature;
  elements.targetList.dataset.count = String(snapshot.session.targetCount);
  elements.targetList.innerHTML = "";
  for (const target of snapshot.targets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "target-tab";
    button.dataset.targetIndex = String(target.index);
    button.classList.toggle("is-active", target.index === snapshot.activeTargetIndex);
    button.textContent = String(target.index + 1);
    button.title = target.index === snapshot.activeTargetIndex ? `当前目标 ${target.index + 1}` : `切换到目标 ${target.index + 1}`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => {
      snapshot = controller.setActiveTarget(target.index);
      render();
    });
    elements.targetList.append(button);
  }
}

function renderRecommendation() {
  const recommendation = snapshot.recommendation;
  const action = recommendation?.skillId ? actionById(recommendation.skillId) : null;
  elements.recommendationIcon.innerHTML = action ? iconMarkup(action) : "";
  elements.recommendationIcon.className = "skill-glyph";
  elements.recommendationName.textContent = action?.name ?? "等待";
  elements.recommendationTarget.textContent = recommendation?.targetIndex == null ? "不限定目标" : `推荐目标：木桩 ${recommendation.targetIndex + 1}`;
  elements.recommendationReason.textContent = recommendation?.reason ?? "等待训练开始";
  elements.recommendationKey.textContent = action ? displayKeyCode(keybinds[action.id]) : "—";
}

function renderResources() {
  const { resources } = snapshot;
  elements.energyValue.textContent = String(Math.round(resources.energy));
  elements.energyMax.textContent = String(resources.maxEnergy);
  elements.energyFill.style.width = `${(resources.energy / resources.maxEnergy) * 100}%`;
  elements.comboValue.textContent = String(resources.comboPoints);
  elements.comboPoints.forEach((point, index) => point.classList.toggle("is-active", index < resources.comboPoints));

  const channelAction = snapshot.channel ? actionById(snapshot.channel.skillId) : null;
  const channelDurationMs = snapshot.channel?.durationMs ?? channelAction?.channel?.durationMs ?? channelAction?.channelMs ?? 0;
  const channelRatio = channelDurationMs ? Math.max(0, Math.min(1, snapshot.channel.remainingMs / channelDurationMs)) : 0;
  elements.channelBar.hidden = !snapshot.channel;
  elements.channelBar.setAttribute("aria-valuenow", String(Math.round(channelRatio * 100)));
  elements.channelFill.style.width = `${channelRatio * 100}%`;
  elements.channelName.textContent = channelAction?.name ?? "持续施法";
  elements.channelTime.textContent = snapshot.channel ? `${(snapshot.channel.remainingMs / 1000).toFixed(1)}` : "0.0";
}

function renderBuffs() {
  for (const card of elements.buffRow.querySelectorAll(".buff-card")) {
    const aura = snapshot.auras[card.dataset.buff];
    card.classList.toggle("is-active", Boolean(aura));
    card.querySelector(".buff-time").textContent = aura
      ? `${formatDuration(aura.remainingMs)}${aura.stacks > 1 ? ` · ${aura.stacks} 层` : ""}`
      : "未激活";
  }
}

function renderSkills() {
  for (const action of currentActions()) {
    const button = skillButtons.get(action.id);
    const cooldown = snapshot.cooldowns[action.id]?.remainingMs ?? 0;
    const cooldownDuration = snapshot.cooldowns[action.id]?.durationMs ?? 0;
    const gcd = action.offGcd ? 0 : snapshot.gcd.remainingMs;
    const ratio = cooldown > 50 && cooldownDuration ? cooldown / cooldownDuration : Math.min(1, gcd / 1000);
    const actionState = snapshot.actionStates[action.id];
    const minimumCost = actionState?.minimumCost ?? action.cost ?? 0;
    const maximumCost = actionState?.maximumCost ?? minimumCost;
    const gcdActive = !action.offGcd && gcd > 50;
    const unavailable = !actionState?.available && actionState?.blockedCode !== "global-cooldown";
    const meta = [];
    if (actionState?.isFree) meta.push("免费");
    else if (maximumCost > minimumCost) meta.push(`${minimumCost}–${maximumCost} 能量`);
    else if (minimumCost) meta.push(`${minimumCost} 能量`);
    if (action.comboSpend) meta.push("消耗 CP");
    else if (action.comboGain) meta.push(`+${action.comboGain} CP`);
    if (cooldown > 50) meta.push(`CD ${(cooldown / 1000).toFixed(1)}s`);
    if (!meta.length) meta.push(action.offGcd ? "非 GCD" : "就绪");
    button.querySelector(".skill-key").textContent = displayKeyCode(keybinds[action.id]);
    button.querySelector(".skill-meta").textContent = meta.join(" · ");
    button.querySelector(".cooldown-number").textContent = cooldown > 50 ? String(Math.ceil(cooldown / 1000)) : "";
    button.style.setProperty("--cooldown-angle", `${Math.max(0, Math.min(1, ratio)) * 360}deg`);
    button.classList.toggle("is-recommended", snapshot.recommendation?.skillId === action.id);
    button.classList.toggle("is-gcd-active", gcdActive);
    button.classList.toggle("is-unavailable", unavailable);

    const item = cooldownItems.get(action.id);
    if (item) {
      const aura = snapshot.auras[action.id];
      item.style.setProperty("--cooldown-angle", `${Math.max(0, Math.min(1, cooldownDuration ? cooldown / cooldownDuration : 0)) * 360}deg`);
      item.querySelector(".cooldown-number").textContent = aura
        ? (aura.remainingMs / 1000).toFixed(1)
        : cooldown > 50 ? String(Math.ceil(cooldown / 1000)) : "";
      item.querySelector("small").textContent = displayKeyCode(keybinds[action.id]);
      item.classList.toggle("is-ready", cooldown <= 50);
      item.classList.toggle("is-aura-active", Boolean(aura));
    }
  }
}

function renderDots() {
  const activeTarget = snapshot.targets[snapshot.activeTargetIndex];
  for (const definition of snapshot.catalog.tracked.dots) {
    const item = dotMonitorItems.get(definition.id);
    if (!item) continue;
    const dot = activeTarget?.dots[definition.id] ?? null;
    const coverage = snapshot.targets.filter((target) => Boolean(target.dots[definition.id])).length;
    const ratio = dot?.baseDurationMs ? Math.min(1, dot.remainingMs / (dot.baseDurationMs * 1.3)) : 0;
    item.style.setProperty("--cooldown-angle", `${ratio * 360}deg`);
    item.querySelector(".cooldown-number").textContent = dot ? (dot.remainingMs / 1000).toFixed(1) : "";
    item.querySelector(".dot-coverage").textContent = dot?.stacks > 1
      ? `${dot.stacks}层 · ${coverage}/${snapshot.session.targetCount}`
      : `${coverage}/${snapshot.session.targetCount}`;
    item.classList.toggle("is-active", Boolean(dot));
    item.classList.toggle("is-inactive", !dot);
    item.classList.toggle("is-refreshable", Boolean(dot?.refreshable));
    item.title = `${definition.name ?? definition.id} · ${dot ? `${formatDuration(dot.remainingMs)}，${dot.stacks > 1 ? `${dot.stacks} 层，` : ""}覆盖 ${coverage}/${snapshot.session.targetCount}` : "当前目标未激活"}`;
  }
}

function renderAuraMonitors() {
  for (const definition of selectedAuraDefinitions()) {
    const item = auraMonitorItems.get(definition.id);
    if (!item) continue;
    const aura = snapshot.auras[definition.id] ?? null;
    const baseDurationMs = definition.durationMs ?? aura?.baseDurationMs ?? aura?.remainingMs ?? 0;
    const ratio = aura && baseDurationMs ? Math.min(1, aura.remainingMs / baseDurationMs) : 0;
    item.style.setProperty("--cooldown-angle", `${ratio * 360}deg`);
    item.querySelector(".cooldown-number").textContent = aura ? (aura.remainingMs / 1000).toFixed(1) : "";
    item.querySelector(".aura-stack").textContent = aura?.stacks > 1 ? `${aura.stacks}层` : "";
    item.classList.toggle("is-active", Boolean(aura));
    item.classList.toggle("is-inactive", !aura);
    item.title = `${definition.name ?? definition.id} · ${aura ? `${formatDuration(aura.remainingMs)}${aura.stacks > 1 ? `，${aura.stacks} 层` : ""}` : "未激活"}`;
  }
}

function renderSequence() {
  const sequence = snapshot.actionHistory.slice(sequenceStartIndex);
  const signature = `${snapshot.profile.id}:${sequenceStartIndex}:${sequence.length}:${snapshot.session.timestamp}`;
  if (signature === lastSequenceSignature) return;
  lastSequenceSignature = signature;
  elements.sequenceCount.textContent = `${sequence.length} 次`;
  if (!sequence.length) {
    elements.sequenceList.innerHTML = `<div class="empty-sequence"><div class="empty-rings" aria-hidden="true"><span></span><span></span></div><strong>尚无施法记录</strong><p>成功施法会按时间从左到右显示。</p></div>`;
    return;
  }
  const verdictLabels = { perfect: "命中推荐", alternate: "非首选", "wrong-target": "目标不符" };
  elements.sequenceList.innerHTML = sequence.map((event) => {
    const action = actionById(event.skillId);
    const recommended = event.recommendation?.skillId ? actionById(event.recommendation.skillId) : null;
    const detail = event.verdict === "perfect"
      ? `${event.before.comboPoints}→${event.after.comboPoints} CP · ${Math.round(event.before.energy)}→${Math.round(event.after.energy)} 能量`
      : `当时推荐：${recommended?.name ?? "等待"}`;
    return `<article class="sequence-entry" data-skill-id="${action.id}"><time class="sequence-time">${formatTime(event.timeMs)}</time><span class="skill-glyph">${iconMarkup(action)}</span><div class="sequence-body"><div class="sequence-topline"><strong>[${displayKeyCode(keybinds[action.id])}] ${action.name}</strong><span class="verdict-label ${event.verdict}">${verdictLabels[event.verdict]}</span></div><span class="sequence-detail">${detail}</span></div></article>`;
  }).join("");
  elements.sequenceList.scrollTop = elements.sequenceList.scrollHeight;
  elements.sequenceList.scrollLeft = elements.sequenceList.scrollWidth;
}

function renderCombatLog() {
  const events = snapshot.eventHistory.filter((event) => ["ACTION_CAST", "INTERNAL_ACTION_CAST", "PROC_TRIGGERED", "AURA_APPLIED", "DOT_APPLIED"].includes(event.type)).slice(-24);
  const signature = `${snapshot.profile.id}:${events.at(-1)?.eventId ?? "none"}:${events.length}`;
  if (signature === lastLogSignature) return;
  lastLogSignature = signature;
  elements.combatLogCount.textContent = `${events.length} 条`;
  elements.combatLogList.innerHTML = events.length ? events.map((event) => {
    const action = event.sourceSkillId ? catalogActionById(event.sourceSkillId) : null;
    const label = action?.name ?? event.effectId ?? "系统";
    const copy = ["ACTION_CAST", "INTERNAL_ACTION_CAST"].includes(event.type) ? `${label} 已施放 · ${event.reason}` : `${label} · ${event.reason}`;
    return `<p class="combat-log-line"><time>[${formatTime(event.timestamp)}]</time> ${copy}</p>`;
  }).join("") : `<p class="combat-log-system">${feedback.message}</p>`;
  elements.combatLogList.scrollTop = elements.combatLogList.scrollHeight;
}

function renderMetrics() {
  const metrics = snapshot.metrics;
  elements.metricAccuracy.textContent = metrics.totalCasts ? `${Math.round(metrics.accuracy)}%` : "—";
  elements.metricPerfect.textContent = `${metrics.perfectCasts} / ${metrics.totalCasts} 次`;
  elements.metricStreak.textContent = String(metrics.currentStreak);
  elements.metricBest.textContent = `最佳 ${metrics.bestStreak}`;
  elements.metricApm.textContent = String(Math.round(metrics.apm));
  elements.metricCasts.textContent = String(metrics.totalCasts);
}

function renderFeedback() {
  elements.feedback.className = `feedback feedback-${feedback.type}`;
  elements.feedback.textContent = feedback.message;
  elements.actionFeedback.className = `action-feedback action-feedback-${feedback.type}`;
  elements.actionFeedback.textContent = feedback.message;
}

function renderStatus() {
  elements.sessionTime.textContent = formatTime(snapshot.session.timestamp);
  elements.sessionProgress.style.width = `${(snapshot.session.timestamp / snapshot.session.durationMs) * 100}%`;
  elements.sessionDurationTotal.textContent = `/ ${formatClockDuration(snapshot.session.durationMs)}`;
  elements.customDuration.value = String(selectedDurationSeconds);
  const ended = snapshot.session.status === "ended";
  elements.sessionStatus.classList.toggle("is-running", hasStarted && isAdvancing && !ended);
  elements.sessionStatus.classList.toggle("is-complete", ended);
  elements.sessionStatusCopy.textContent = ended ? "训练完成" : !hasStarted ? "等待开始" : isAdvancing ? "训练中" : "已暂停";
  const icon = elements.startPause.querySelector(".button-icon");
  const label = elements.startPause.querySelector(".button-label");
  icon.textContent = isAdvancing ? "Ⅱ" : ended ? "↻" : "▶";
  label.textContent = isAdvancing ? "暂停" : ended ? "再练一次" : hasStarted ? "继续" : "开始训练";
  for (const button of elements.targetCountControl.querySelectorAll("button")) {
    button.classList.toggle("is-active", Number(button.dataset.targetCount) === selectedTargetCount);
  }
  for (const button of elements.durationPresets.querySelectorAll("button")) {
    button.classList.toggle("is-active", Number(button.dataset.durationSeconds) === selectedDurationSeconds);
  }
  elements.footerProfile.textContent = `${snapshot.profile.label} · ${snapshot.session.targetCount} 目标 · ${snapshot.session.durationMs / 1000} 秒`;
}

function render() {
  renderStatus();
  renderTargets();
  renderRecommendation();
  renderResources();
  renderBuffs();
  renderSkills();
  renderAuraMonitors();
  renderDots();
  renderSequence();
  renderCombatLog();
  renderMetrics();
  renderFeedback();
}

async function copySequence() {
  const sequence = snapshot.actionHistory.slice(sequenceStartIndex);
  if (!sequence.length) return showToast("还没有可复制的施法顺序。");
  const lines = sequence.map((event, index) => `${String(index + 1).padStart(2, "0")}. ${formatTime(event.timeMs)}  ${actionById(event.skillId).name}  → 木桩 ${event.targetIndex + 1}  [${event.verdict}]`);
  const text = [`${snapshot.profile.label} · ${snapshot.session.targetCount} 目标`, ...lines].join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast(`已复制 ${sequence.length} 次施法。`);
}

function toggleSession() {
  if (snapshot.session.status === "ended") prepareSession({ preserveStarted: true });
  else if (!hasStarted) {
    hasStarted = true;
    isAdvancing = true;
    feedback = { type: "success", message: "训练开始。" };
    render();
  } else {
    isAdvancing = !isAdvancing;
    feedback = { type: "info", message: isAdvancing ? "训练继续。" : "训练已暂停。" };
    render();
  }
}

function restartSession() {
  prepareSession();
  showToast("训练已重置");
}

function setTrainingDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    elements.customDuration.value = String(selectedDurationSeconds);
    feedback = { type: "warning", message: `训练时长请输入 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒。` };
    renderFeedback();
    return;
  }
  const normalized = Math.round(parsed);
  if (normalized < MIN_DURATION_SECONDS || normalized > MAX_DURATION_SECONDS) {
    elements.customDuration.value = String(selectedDurationSeconds);
    feedback = { type: "warning", message: `训练时长限 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒。` };
    renderFeedback();
    return;
  }
  selectedDurationSeconds = normalized;
  saveDurationSeconds();
  if (!hasStarted) {
    prepareSession();
    feedback = { type: "info", message: `训练时长已设为 ${selectedDurationSeconds} 秒。` };
  } else {
    feedback = { type: "info", message: `训练时长已设为 ${selectedDurationSeconds} 秒，将在重新开始时生效。` };
  }
  render();
}

function onGlobalKeydown(event) {
  if (isDialogOpen(elements.keybindDialog)) return void captureKeybind(event);
  if (isDialogOpen(elements.auraMonitorDialog) || isDialogOpen(elements.simcImportDialog)) return;
  if (event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable) return;
  if (event.code === "Space") {
    event.preventDefault();
    toggleSession();
    return;
  }
  if (event.code === "Backspace") {
    event.preventDefault();
    restartSession();
    return;
  }
  const skillId = getSkillForCode(event.code);
  if (!skillId || !actionById(skillId)) return;
  event.preventDefault();
  castSkill(skillId, "keyboard");
}

function isEditableEventTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

function onGlobalMouseDown(event) {
  const binding = bindingFromMouseButton(event.button);
  if (!binding) return;
  if (isSideMouseBinding(binding)) event.preventDefault();
  if (isDialogOpen(elements.keybindDialog)) {
    if (listeningSkillId) capturePointingBinding(event, binding);
    return;
  }
  if (isDialogOpen(elements.auraMonitorDialog) || isDialogOpen(elements.simcImportDialog)) return;
  if (event.metaKey || event.ctrlKey || event.altKey || isEditableEventTarget(event.target)) return;
  const skillId = getSkillForCode(binding);
  if (!skillId || !actionById(skillId)) return;
  event.preventDefault();
  castSkill(skillId, "mouse-binding");
}

function suppressAuxiliaryMouseDefault(event) {
  const binding = bindingFromMouseButton(event.button);
  if (!binding) return;
  if (isSideMouseBinding(binding)
    || getSkillForCode(binding)
    || (isDialogOpen(elements.keybindDialog) && listeningSkillId)) {
    event.preventDefault();
  }
}

function onGlobalWheel(event) {
  const binding = bindingFromWheelDelta(event.deltaY);
  if (!binding) return;
  if (isDialogOpen(elements.keybindDialog)) {
    if (listeningSkillId && capturePointingBinding(event, binding)) {
      wheelInputBlockedUntil = performance.now() + WHEEL_CAPTURE_SUPPRESSION_MS;
    }
    return;
  }
  if (isDialogOpen(elements.auraMonitorDialog) || isDialogOpen(elements.simcImportDialog)) return;
  if (event.metaKey || event.ctrlKey || event.altKey || isEditableEventTarget(event.target)) return;
  const skillId = getSkillForCode(binding);
  if (!skillId || !actionById(skillId)) return;
  event.preventDefault();
  const now = performance.now();
  if (now < wheelInputBlockedUntil) return;
  wheelInputBlockedUntil = now + WHEEL_TRIGGER_INTERVAL_MS;
  castSkill(skillId, "wheel-binding");
}

elements.startPause.addEventListener("click", toggleSession);
elements.restart.addEventListener("click", restartSession);
elements.buildSelect.addEventListener("change", () => {
  selectedBuildKey = elements.buildSelect.value;
  saveSelectedBuildKey();
  prepareSession();
});
elements.openSimcImport.addEventListener("click", openSimcImportDialog);
elements.applySimcImport.addEventListener("click", applySimcImport);
elements.clearSimcImport.addEventListener("click", clearSimcImport);
elements.targetCountControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-target-count]");
  if (!button) return;
  selectedTargetCount = Number(button.dataset.targetCount);
  prepareSession();
});
elements.durationPresets.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-duration-seconds]");
  if (!button) return;
  setTrainingDuration(button.dataset.durationSeconds);
});
elements.customDuration.addEventListener("change", () => {
  setTrainingDuration(elements.customDuration.value);
});
elements.copySequence.addEventListener("click", copySequence);
elements.clearSequence.addEventListener("click", () => {
  sequenceStartIndex = snapshot.actionHistory.length;
  lastSequenceSignature = "";
  renderSequence();
});
elements.buffFilter.addEventListener("input", applyBuffFilter);
elements.openKeybinds.addEventListener("click", () => {
  listeningSkillId = null;
  elements.keybindHint.textContent = "键位会自动保存在当前浏览器。";
  renderKeybinds();
  openModalDialog(elements.keybindDialog);
});
elements.keybindDialog.addEventListener("close", () => {
  listeningSkillId = null;
  renderKeybinds();
});
elements.resetKeybinds.addEventListener("click", () => {
  for (const action of currentActions()) keybinds[action.id] = action.defaultCode ?? "";
  saveKeybinds();
  listeningSkillId = null;
  elements.keybindHint.textContent = "已恢复当前构筑的默认键位。";
  renderKeybinds();
  renderSkills();
});
elements.auraMonitorFilter.addEventListener("input", applyAuraMonitorFilter);
elements.openAuraMonitor.addEventListener("click", () => {
  elements.auraMonitorHint.textContent = "选择会随当前构筑保存在此浏览器中。";
  createAuraMonitorRows();
  openModalDialog(elements.auraMonitorDialog);
  elements.auraMonitorFilter.focus();
});
elements.auraMonitorList.addEventListener("change", (event) => {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  const nextSelection = new Set(selectedAuraIds());
  if (input.checked) nextSelection.add(input.value);
  else nextSelection.delete(input.value);
  setSelectedAuraIds([...nextSelection]);
  createAuraMonitorItems();
  renderAuraMonitors();
  elements.auraMonitorHint.textContent = `${selectedAuraIds().length} 个增益已加入冷却管理器。`;
});
elements.clearAuraMonitors.addEventListener("click", () => {
  setSelectedAuraIds([]);
  createAuraMonitorItems();
  createAuraMonitorRows();
  renderAuraMonitors();
  elements.auraMonitorHint.textContent = "已清空当前构筑的增益监控。";
});
elements.releaseUpdate.addEventListener("click", () => {
  globalThis.location.reload();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void discoverReleaseUpdate();
});
for (const dialog of [elements.keybindDialog, elements.auraMonitorDialog, elements.simcImportDialog]) {
  dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => closeModalDialog(dialog));
  });
  dialog.addEventListener("cancel", (event) => {
    if (!dialog.classList.contains("is-fallback-open")) return;
    event.preventDefault();
    closeModalDialog(dialog);
  });
}
document.addEventListener("keydown", onGlobalKeydown, true);
document.addEventListener("mousedown", onGlobalMouseDown, true);
document.addEventListener("mouseup", suppressAuxiliaryMouseDefault, true);
document.addEventListener("auxclick", suppressAuxiliaryMouseDefault, true);
document.addEventListener("wheel", onGlobalWheel, { capture: true, passive: false });
installIconLoadRecovery();

createBuildOptions();
prepareSession();
applyProfileCacheNotice();
void discoverReleaseUpdate();

let previousFrame = performance.now();
function frame(now) {
  const deltaMs = Math.min(100, now - previousFrame);
  previousFrame = now;
  if (isAdvancing && snapshot.session.status === "running") {
    snapshot = controller.advanceTime(deltaMs);
    if (snapshot.session.status === "ended") isAdvancing = false;
    render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
