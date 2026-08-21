import { deepFreeze, invariant } from "./contracts.js";
import { getLastProfileValue, parseSimcProfile } from "./simc-profile-parser.js";

export function normalizeBuildInput(input) {
  invariant(input && typeof input === "object", "Build input is required");
  if (input.schemaVersion === 1 && input.talentCode && Array.isArray(input.setBonuses)) {
    return deepFreeze({
      ...input,
      sourceProfileText: input.sourceProfileText ?? null,
      simcProfile: input.simcProfile ?? null,
      unsupportedFields: [...(input.unsupportedFields ?? [])],
    });
  }

  if (input.kind === "simc-profile") {
    invariant(typeof input.profileText === "string", "simc-profile input requires profileText");
    const simcProfile = parseSimcProfile(input.profileText);
    const talentCode = getLastProfileValue(simcProfile, "talents");
    invariant(talentCode, "SimC profile does not contain a talents= export string");
    const specialization = getLastProfileValue(simcProfile, "spec") ?? "feral";
    invariant(specialization.toLowerCase() === "feral", `SimC profile spec '${specialization}' is not supported`);
    const actorName = getLastProfileValue(simcProfile, "druid");

    return deepFreeze({
      schemaVersion: 1,
      kind: "simc-profile",
      id: input.id ?? actorName ?? "simc-feral-profile",
      label: input.label ?? actorName ?? "SimC 野性德鲁伊构筑",
      talentCode,
      setBonuses: [...new Set(input.setBonuses ?? [])],
      source: input.source ?? "simc-profile-text",
      sourceProfileText: input.profileText,
      simcProfile,
      unsupportedFields: simcProfile.unsupportedFields,
    });
  }

  invariant(input.kind === "talent-code", `Unsupported build input kind '${input.kind}'`);
  invariant(typeof input.talentCode === "string" && input.talentCode, "talent-code input requires talentCode");
  return deepFreeze({
    schemaVersion: 1,
    kind: "talent-code",
    id: input.id ?? `feral-${input.talentCode.slice(0, 12)}`,
    label: input.label ?? "野性德鲁伊自定义构筑",
    talentCode: input.talentCode,
    setBonuses: [...new Set(input.setBonuses ?? [])],
    source: input.source ?? "talent-code",
    sourceProfileText: null,
    simcProfile: null,
    unsupportedFields: [],
  });
}

export function buildInputFromFixture(fixture) {
  if (fixture.profileText) {
    return normalizeBuildInput({
      kind: "simc-profile",
      id: fixture.id,
      label: fixture.label,
      profileText: fixture.profileText,
      setBonuses: fixture.setBonuses,
      source: fixture.source,
    });
  }
  return normalizeBuildInput({
    kind: "talent-code",
    id: fixture.id,
    label: fixture.label,
    talentCode: fixture.talentCode,
    setBonuses: fixture.setBonuses,
    source: fixture.source,
  });
}
