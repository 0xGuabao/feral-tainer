function sortedNumbers(values) {
  return [...(values ?? [])].map(Number).filter(Number.isFinite).sort((left, right) => left - right);
}

export function createEquipmentVariantKey(item) {
  return [
    `item:${item.itemId ?? "unknown"}`,
    `ilevel:${item.itemLevel ?? "unknown"}`,
    `bonus:${sortedNumbers(item.bonusIds).join("/")}`,
    `gems:${sortedNumbers(item.gemIds).join("/")}`,
    `enchant:${item.enchantId ?? "none"}`,
    `crafted:${sortedNumbers(item.craftedStatIds).join("/")}`,
  ].join("|");
}
