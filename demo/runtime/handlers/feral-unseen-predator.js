function randomTarget(rng, targetCount) {
  return Math.min(targetCount - 1, Math.floor(rng.next() * targetCount));
}

function executeUnseenAttack({ context, profile, host, rng }, effectiveComboPoints) {
  const targetIndex = randomTarget(rng, host.targetCount());
  const actionId = host.targetCount() > 3 ? "unseenSwipe" : "unseenSlash";
  host.executeInternalAction(actionId, targetIndex, {
    originSkillId: context.action?.id ?? context.sourceSkillId,
    effectiveComboPoints,
    handlerId: "feral_unseen_predator",
  });

  if ((profile.build.talents.byToken.unseen_predator?.rank ?? 0) >= 2) {
    host.applyAura("unseenPredatorsCraving", {
      durationMs: Math.max(1, effectiveComboPoints) * 1000,
      stacks: 1,
      maxStacks: 1,
      replaceStacks: true,
      refreshMode: "extend",
      sourceSkillId: actionId,
      reason: "unseen-attack",
    });
  }
}

export function executeFeralUnseenPredator(handlerContext) {
  const { operation, context, host } = handlerContext;
  if (operation.phase === "bite") {
    executeUnseenAttack(handlerContext, context.effectiveComboPoints);
    return;
  }
  if (operation.phase === "stalking-builder") {
    executeUnseenAttack(handlerContext, profileMaxCombo(handlerContext.profile));
    host.consumeAura("stalkingPredator", 1, context.action?.id ?? null);
    return;
  }
  throw new Error(`Unknown feral_unseen_predator phase '${operation.phase}'`);
}

function profileMaxCombo(profile) {
  return profile.resources.comboPoints.max;
}
