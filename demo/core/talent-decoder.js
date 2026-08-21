import { DRUID_TALENT_TREE_12_1 } from "../data/12.1/druid-talent-tree.generated.js";
import { deepFreeze, invariant } from "./contracts.js";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEADER_BITS = Object.freeze({ version: 8, specialization: 16, treeHash: 128 });
const RANK_BITS = 6;
const CHOICE_BITS = 2;
const NODE_TIERED = 1;
const NODE_CHOICE = 2;
const NODE_SELECTION = 3;
const TREE_HERO = 3;
const TREE_SELECTION = 4;

function talentToken(name) {
  return name
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

class BitReader {
  constructor(value) {
    const invalid = [...value].find((character) => !BASE64.includes(character));
    invariant(!invalid, `Talent code contains invalid character '${invalid}'`);
    this.value = value;
    this.offset = 0;
  }

  get totalBits() {
    return this.value.length * 6;
  }

  read(bitCount) {
    invariant(this.offset + bitCount <= this.totalBits, "Talent code ended before all tree nodes were decoded");
    let result = 0;
    for (let index = 0; index < bitCount; index += 1) {
      const absoluteBit = this.offset + index;
      const character = BASE64.indexOf(this.value[Math.floor(absoluteBit / 6)]);
      const bit = (character >> (absoluteBit % 6)) & 1;
      result += bit * 2 ** index;
    }
    this.offset += bitCount;
    return result;
  }

  readHex(bitCount) {
    invariant(bitCount % 4 === 0, "Hex fields must contain a whole number of nibbles");
    invariant(this.offset + bitCount <= this.totalBits, "Talent code ended before the requested field was decoded");
    let result = 0n;
    for (let index = 0; index < bitCount; index += 1) {
      const absoluteBit = this.offset + index;
      const character = BASE64.indexOf(this.value[Math.floor(absoluteBit / 6)]);
      const bit = (character >> (absoluteBit % 6)) & 1;
      if (bit) result |= 1n << BigInt(index);
    }
    this.offset += bitCount;
    return result.toString(16).padStart(bitCount / 4, "0");
  }
}

class BitWriter {
  constructor() {
    this.bits = [];
  }

  write(bitCount, value) {
    const numericValue = BigInt(value);
    for (let index = 0; index < bitCount; index += 1) {
      this.bits.push(Number((numericValue >> BigInt(index)) & 1n));
    }
  }

  toString() {
    let result = "";
    for (let offset = 0; offset < this.bits.length; offset += 6) {
      let value = 0;
      for (let index = 0; index < 6; index += 1) {
        value += (this.bits[offset + index] ?? 0) << index;
      }
      result += BASE64[value];
    }
    return result;
  }
}

function allSpecsAreZero(specIds) {
  return specIds.every((id) => id === 0);
}

function isAvailableToSpec(entry, specId) {
  return (
    entry.treeIndex === TREE_HERO ||
    allSpecsAreZero(entry.specIds) ||
    entry.specIds.includes(specId)
  );
}

function allocateTieredRanks(node, rank) {
  const selections = [];
  let remaining = rank;
  for (const entry of node.entries) {
    const allocated = Math.min(remaining, entry.maxRanks);
    if (allocated > 0) selections.push({ entry, rank: allocated });
    remaining -= allocated;
    if (remaining <= 0) break;
  }
  return selections;
}

export class TalentDecoder {
  constructor({ treeData = DRUID_TALENT_TREE_12_1, specialization = "feral" } = {}) {
    this.treeData = treeData;
    this.specialization = specialization;
    this.specId = treeData.specializationIds[specialization];
    invariant(this.specId, `Unknown specialization '${specialization}' for talent tree ${treeData.gameVersion}`);
  }

  decode(talentCode) {
    invariant(typeof talentCode === "string" && talentCode.length > 0, "A talent code is required");
    const reader = new BitReader(talentCode.trim());
    const serializationVersion = reader.read(HEADER_BITS.version);
    const specId = reader.read(HEADER_BITS.specialization);
    const treeHash = reader.readHex(HEADER_BITS.treeHash);

    invariant(
      serializationVersion === this.treeData.serializationVersion,
      `Talent serialization version ${serializationVersion} is not supported (expected ${this.treeData.serializationVersion})`,
    );
    invariant(specId === this.specId, `Talent code is for specialization ${specId}, expected ${this.specId}`);

    const serializedSelections = [];
    const warnings = [];
    for (const node of this.treeData.nodes) {
      if (!reader.read(1)) continue;

      let entry = node.entries[0];
      const isTiered = entry.nodeType === NODE_TIERED;
      const maxRank = isTiered
        ? node.entries.reduce((total, candidate) => total + candidate.maxRanks, 0)
        : entry.maxRanks;
      const purchased = Boolean(reader.read(1));
      let rank = purchased ? maxRank : 1;
      let partial = false;
      let choiceIndex = 0;

      if (purchased) {
        partial = Boolean(reader.read(1));
        if (partial) {
          rank = reader.read(RANK_BITS);
          invariant(rank > 0 && rank < maxRank, `Invalid partial rank ${rank}/${maxRank} at node ${node.nodeId}`);
        }

        const hasChoiceIndex = Boolean(reader.read(1));
        if (hasChoiceIndex) {
          invariant(
            entry.nodeType === NODE_CHOICE || entry.nodeType === NODE_SELECTION,
            `Node ${node.nodeId} encoded a choice index but is not a choice node`,
          );
          choiceIndex = reader.read(CHOICE_BITS);
          invariant(choiceIndex < node.entries.length, `Choice index ${choiceIndex} is out of range at node ${node.nodeId}`);
          entry = node.entries[choiceIndex];
        }
      }

      const allocated = isTiered
        ? allocateTieredRanks(node, rank)
        : [{ entry, rank }];
      for (const selection of allocated) {
        if (!isAvailableToSpec(selection.entry, specId)) {
          if (selection.entry.treeIndex === TREE_SELECTION) {
            warnings.push({
              code: "IGNORED_OTHER_SPEC_SELECTION",
              nodeId: node.nodeId,
              entryId: selection.entry.entryId,
              name: selection.entry.name,
            });
            continue;
          }
          throw new Error(
            `Talent '${selection.entry.name}' (${selection.entry.entryId}) is unavailable to specialization ${specId}`,
          );
        }

        serializedSelections.push({
          ...selection.entry,
          token: talentToken(selection.entry.name),
          rank: selection.rank,
          purchased,
          partial,
          choiceIndex,
        });
      }
    }

    const activeSubtreeIds = [
      ...new Set(
        serializedSelections
          .filter((entry) => entry.treeIndex === TREE_SELECTION && entry.subtreeId)
          .map((entry) => entry.subtreeId),
      ),
    ];
    const activeSubtreeSet = new Set(activeSubtreeIds);
    const selections = serializedSelections.filter(
      (entry) => entry.treeIndex !== TREE_HERO || activeSubtreeSet.has(entry.subtreeId),
    );
    const inactiveHeroSelections = serializedSelections.filter(
      (entry) => entry.treeIndex === TREE_HERO && !activeSubtreeSet.has(entry.subtreeId),
    );

    const byEntryId = Object.fromEntries(selections.map((entry) => [entry.entryId, entry]));
    const bySpellId = Object.fromEntries(selections.map((entry) => [entry.spellId, entry]));
    const byToken = {};
    for (const entry of selections) {
      const existing = byToken[entry.token];
      byToken[entry.token] = existing
        ? {
            ...existing,
            rank: existing.rank + entry.rank,
            entryIds: [...existing.entryIds, entry.entryId],
            spellIds: [...new Set([...existing.spellIds, entry.spellId])],
          }
        : {
            ...entry,
            entryIds: [entry.entryId],
            spellIds: [entry.spellId],
          };
    }
    return deepFreeze({
      schemaVersion: 1,
      sourceKind: "wow-talent-code",
      sourceCode: talentCode.trim(),
      gameVersion: this.treeData.gameVersion,
      simcVersion: this.treeData.simcVersion,
      serializationVersion,
      specialization: this.specialization,
      specializationId: specId,
      treeHash,
      selections,
      serializedSelections,
      inactiveHeroSelections,
      byEntryId,
      bySpellId,
      byToken,
      activeSubtreeIds,
      warnings,
      consumedBits: reader.offset,
      totalBits: reader.totalBits,
    });
  }
}

export class TalentEncoder {
  constructor({ treeData = DRUID_TALENT_TREE_12_1, specialization = "feral" } = {}) {
    this.treeData = treeData;
    this.specialization = specialization;
    this.specId = treeData.specializationIds[specialization];
    invariant(this.specId, `Unknown specialization '${specialization}' for talent tree ${treeData.gameVersion}`);
  }

  encode(decodedOrSelections) {
    const selections = Array.isArray(decodedOrSelections)
      ? decodedOrSelections
      : decodedOrSelections?.serializedSelections ?? decodedOrSelections?.selections;
    invariant(Array.isArray(selections), "TalentEncoder.encode requires decoded selections");
    const selectionsByNode = new Map();
    for (const selection of selections) {
      if (!selectionsByNode.has(selection.nodeId)) selectionsByNode.set(selection.nodeId, []);
      selectionsByNode.get(selection.nodeId).push(selection);
    }

    const writer = new BitWriter();
    writer.write(HEADER_BITS.version, this.treeData.serializationVersion);
    writer.write(HEADER_BITS.specialization, this.specId);
    writer.write(HEADER_BITS.treeHash, 0);

    for (const node of this.treeData.nodes) {
      const selected = selectionsByNode.get(node.nodeId) ?? [];
      if (!selected.length) {
        writer.write(1, 0);
        continue;
      }

      writer.write(1, 1);
      const firstEntry = node.entries[0];
      const isTiered = firstEntry.nodeType === NODE_TIERED;
      const maxRank = isTiered
        ? node.entries.reduce((total, entry) => total + entry.maxRanks, 0)
        : selected[0].maxRanks;
      const rank = selected.reduce((total, entry) => total + entry.rank, 0);
      const purchased = selected.some((entry) => entry.purchased !== false);
      writer.write(1, purchased ? 1 : 0);
      if (!purchased) continue;

      const partial = rank !== maxRank;
      writer.write(1, partial ? 1 : 0);
      if (partial) writer.write(RANK_BITS, rank);

      const isChoice = firstEntry.nodeType === NODE_CHOICE || firstEntry.nodeType === NODE_SELECTION;
      writer.write(1, isChoice ? 1 : 0);
      if (isChoice) {
        const choiceIndex = node.entries.findIndex((entry) => entry.entryId === selected[0].entryId);
        invariant(choiceIndex >= 0 && choiceIndex < 2 ** CHOICE_BITS, `Unable to encode choice at node ${node.nodeId}`);
        writer.write(CHOICE_BITS, choiceIndex);
      }
    }

    return writer.toString();
  }
}

export function decodeFeralTalentCode(talentCode) {
  return new TalentDecoder().decode(talentCode);
}

export function encodeFeralTalentCode(decodedOrSelections) {
  return new TalentEncoder().encode(decodedOrSelections);
}

export { talentToken };
