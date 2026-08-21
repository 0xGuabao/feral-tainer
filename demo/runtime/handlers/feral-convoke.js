const CAST = Object.freeze({
  OFFSPEC: "offspec",
  SPEC: "spec",
  EXCEPTIONAL: "exceptional",
  MAIN: "main",
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function randomRange(rng, minimum, maximum) {
  return minimum + (maximum - minimum) * rng.next();
}

function randomIndex(rng, length) {
  return Math.min(length - 1, Math.floor(rng.next() * length));
}

function shuffle(rng, values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(rng, index + 1);
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function gaussian(rng, mean, standardDeviation) {
  const first = Math.max(Number.EPSILON, rng.next());
  const second = rng.next();
  const standardNormal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return mean + standardDeviation * standardNormal;
}

function boundedGaussian(rng, { mean, standardDeviation }, minimum, maximum) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const value = gaussian(rng, mean, standardDeviation);
    if (value >= minimum && value <= maximum) return value;
  }
  return clamp(mean, minimum, maximum);
}

function weightedPick(rng, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return entries.at(-1).value;
}

function drawExceptional(rng, host, deckSize) {
  const state = host.getMechanicState("feral_convoke") ?? {};
  if (!Array.isArray(state.exceptionalDeck) || state.exceptionalDeckSize !== deckSize || state.exceptionalDeck.length === 0) {
    state.exceptionalDeckSize = deckSize;
    state.exceptionalDeck = shuffle(rng, [true, ...Array.from({ length: deckSize - 1 }, () => false)]);
  }
  const exceptional = state.exceptionalDeck.pop();
  state.convokeCasts = (state.convokeCasts ?? 0) + 1;
  host.setMechanicState("feral_convoke", state);
  return exceptional;
}

function startConvoke({ context, host, rng }) {
  const channel = context.channel;
  const channelDefinition = context.action.channel;
  const parameters = channelDefinition.parameters;
  const totalTicks = channelDefinition.tickCount;
  const castList = [];
  const offspecCount = Math.floor(randomRange(rng, ...parameters.offspecRange));
  castList.push(...Array.from({ length: Math.min(totalTicks, offspecCount) }, () => CAST.OFFSPEC));

  const exceptional = drawExceptional(rng, host, parameters.exceptionalDeckSize);
  if (exceptional && castList.length < totalTicks) castList.push(CAST.EXCEPTIONAL);

  const remainingForBites = Math.max(0, totalTicks - castList.length);
  const biteCount = Math.floor(boundedGaussian(rng, parameters.biteGaussian, 0, remainingForBites));
  castList.push(...Array.from({ length: biteCount }, () => CAST.MAIN));
  castList.push(...Array.from({ length: totalTicks - castList.length }, () => CAST.SPEC));

  channel.payload = {
    handlerId: "feral_convoke",
    castList,
    initialComposition: {
      offspec: offspecCount,
      exceptional: exceptional ? 1 : 0,
      main: biteCount,
      spec: totalTicks - offspecCount - (exceptional ? 1 : 0) - biteCount,
    },
    guidance: parameters.guidance,
    lastInternalActionId: null,
  };
  host.emit("CUSTOM_MECHANIC_STARTED", {
    sourceSkillId: context.action.id,
    targetIndex: context.targetIndex,
    reason: "feral-convoke-cast-list-created",
    metadata: {
      handlerId: "feral_convoke",
      totalTicks,
      guidance: parameters.guidance,
      exceptional,
      composition: channel.payload.initialComposition,
    },
  });
}

function resolveCastType(rng, baseType) {
  if (baseType === CAST.EXCEPTIONAL) return "feralFrenzy";
  if (baseType === CAST.MAIN) return "ferociousBite";
  if (baseType === CAST.OFFSPEC) {
    return weightedPick(rng, [
      { value: "heal", weight: 0.35 },
      { value: "moonfire", weight: 0.5 },
      { value: "wrath", weight: 0.15 },
    ]);
  }
  return weightedPick(rng, [
    { value: "shred", weight: 0.1 },
    { value: "rake", weight: 0.22 },
  ]);
}

function tickConvoke({ context, host, rng }) {
  const channel = context.channel;
  const castList = channel.payload?.castList;
  if (!castList?.length) return;

  const castIndex = randomIndex(rng, castList.length);
  const [baseType] = castList.splice(castIndex, 1);
  let castType = resolveCastType(rng, baseType);
  let targetIndex = castType === "ferociousBite" || castType === "feralFrenzy"
    ? host.activeTargetIndex()
    : randomIndex(rng, host.targetCount());
  let convertedFrom = null;

  if (castType === "heal") {
    castType = rng.next() < 0.5 ? "regrowth" : "rejuvenation";
    targetIndex = null;
  } else if (castType === "moonfire" && host.hasDot(targetIndex, "moonfire")) {
    convertedFrom = "moonfire";
    castType = "wrath";
  } else if (castType === "rake" && host.hasDot(targetIndex, "rake")) {
    convertedFrom = "rake";
    castType = "shred";
  }

  const actionIds = {
    wrath: "convokeWrath",
    regrowth: "convokeRegrowth",
    rejuvenation: "convokeRejuvenation",
    rake: "convokeRake",
    shred: "convokeShred",
    moonfire: "convokeMoonfire",
    feralFrenzy: "convokeFeralFrenzy",
    ferociousBite: "convokeFerociousBite",
  };
  const internalActionId = actionIds[castType];
  channel.payload.lastInternalActionId = internalActionId;
  host.executeInternalAction(internalActionId, targetIndex, {
    originSkillId: context.action.id,
    baseCastType: baseType,
    convertedFrom,
    channelTick: channel.ticksCompleted,
    channelTotalTicks: channel.totalTicks,
  });
}

export function executeFeralConvoke(handlerContext) {
  if (handlerContext.operation.phase === "start") return startConvoke(handlerContext);
  if (handlerContext.operation.phase === "tick") return tickConvoke(handlerContext);
  throw new Error(`Unknown feral_convoke phase '${handlerContext.operation.phase}'`);
}
