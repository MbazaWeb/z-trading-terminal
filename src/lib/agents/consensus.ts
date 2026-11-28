// Consensus evaluation — collects every agent's signal, weights each vote by
// the agent's historical accuracy (winRate) and current confidence, then
// produces a single `ConsensusResult` the bot / TradePanel can act on.
//
// The agents also "talk" to each other: agents that landed on the same side
// send agreement messages, agents on the opposing side send disagreement
// messages. The thread is surfaced in the Agent Discussion panel.
//
// Specialist agents (Stop Loss Sentinel, Take Profit Hunter) always emit
// HOLD signals — they never vote on direction. Instead they supply
// recommended stop-loss / take-profit levels and a risk score through their
// `indicators` array. The consensus engine extracts those values into
// `executionParams` so the trade-execution layer can attach them to the
// resulting order.

import type {
  AgentCore,
  AgentMessage,
  AgentSignal,
  ConsensusExecutionParams,
  ConsensusResult,
  ConsensusVote,
} from "./types";

const CONSENSUS_THRESHOLD = 70;

// Agent ids that never vote on direction — they supply execution parameters
// only (SL / TP / risk score).
const SPECIALIST_AGENT_IDS = new Set<string>([
  "stopLoss",
  "stopWin",
]);

let msgCounter = 0;
function nextMsgId(): string {
  msgCounter += 1;
  return `msg-${msgCounter}`;
}

function findIndicatorValue(
  signal: AgentSignal | undefined,
  name: string,
): number | undefined {
  if (!signal) return undefined;
  const ind = signal.indicators.find((i) => i.name === name);
  return ind ? ind.value : undefined;
}

export function evaluateConsensus(
  signals: AgentSignal[],
  agents: AgentCore[],
): ConsensusResult {
  const now = Date.now();
  const byId = new Map(agents.map((a) => [a.id, a]));

  // Specialist agents are excluded from the directional vote outright —
  // even if one were to slip a non-hold action through, we drop it here.
  const directional = signals.filter(
    (s) => !SPECIALIST_AGENT_IDS.has(s.agentId),
  );
  // Only active agents vote; HOLD signals do not vote but still appear in
  // the discussion as neutral observations.
  const voting = directional.filter((s) => s.action !== "hold");
  const votes: ConsensusVote[] = voting.map((s) => {
    const agent = byId.get(s.agentId);
    const winRate = agent?.winRate ?? 50;
    // Weight = historical accuracy * current confidence / 100. Range ~0-95.
    const weight = Math.max(0, (winRate / 100) * (s.confidence / 100) * 100);
    return {
      agentId: s.agentId,
      agentName: s.agentName,
      action: s.action,
      confidence: s.confidence,
      weight: Math.round(weight * 100) / 100,
    };
  });

  let buyWeight = 0;
  let sellWeight = 0;
  for (const v of votes) {
    if (v.action === "buy") buyWeight += v.weight;
    else if (v.action === "sell") sellWeight += v.weight;
  }
  const totalWeight = buyWeight + sellWeight;

  let decision: ConsensusResult["decision"] = "hold";
  let totalConfidence = 0;
  let reason = "";

  if (totalWeight <= 0) {
    decision = "hold";
    totalConfidence = 0;
    reason = "No agent voted with directional conviction — all signals on hold.";
  } else if (buyWeight > sellWeight) {
    decision = "buy";
    totalConfidence = Math.round((buyWeight / totalWeight) * 100);
    reason = `${Math.round(
      (buyWeight / totalWeight) * 100,
    )}% weighted consensus on BUY across ${votes.length} voting agent(s).`;
  } else if (sellWeight > buyWeight) {
    decision = "sell";
    totalConfidence = Math.round((sellWeight / totalWeight) * 100);
    reason = `${Math.round(
      (sellWeight / totalWeight) * 100,
    )}% weighted consensus on SELL across ${votes.length} voting agent(s).`;
  } else {
    decision = "hold";
    totalConfidence = 50;
    reason = "Voting tied between BUY and SELL — no directional consensus.";
  }

  // ---- Specialist execution params ---------------------------------------
  // Pull the recommended SL / TP / risk score from the specialist agents'
  // indicators. For SL and TP we pick the side that matches the consensus
  // decision so the value is the one the trader would actually use.
  const stopLossSig = signals.find((s) => s.agentId === "stopLoss");
  const stopWinSig = signals.find((s) => s.agentId === "stopWin");
  const riskSig = signals.find((s) => s.agentId === "risk");

  const slValue =
    decision === "sell"
      ? findIndicatorValue(stopLossSig, "ShortSL")
      : findIndicatorValue(stopLossSig, "LongSL");
  const tpValue =
    decision === "sell"
      ? findIndicatorValue(stopWinSig, "ShortTP")
      : findIndicatorValue(stopWinSig, "LongTP");
  const riskScore = findIndicatorValue(riskSig, "RiskScore");

  const executionParams: ConsensusExecutionParams = {};
  if (slValue !== undefined) executionParams.stopLoss = slValue;
  if (tpValue !== undefined) executionParams.takeProfit = tpValue;
  if (riskScore !== undefined) executionParams.riskScore = riskScore;

  // ---- Agent discussion thread --------------------------------------------
  // Agents on the winning side send agreement messages to each other; agents
  // on the losing side (or hold) send disagreement messages to the winning
  // side.
  const discussion: AgentMessage[] = [];
  const winners = votes.filter((v) => v.action === decision);
  const losers = votes.filter((v) => v.action !== decision && v.action !== "hold");
  const holders = directional.filter((s) => s.action === "hold");

  // Winner -> winner agreement.
  for (let i = 0; i < winners.length; i++) {
    for (let j = i + 1; j < winners.length; j++) {
      const from = winners[i];
      const to = winners[j];
      discussion.push({
        id: nextMsgId(),
        fromAgentId: from.agentId,
        fromAgentName: from.agentName,
        toAgentId: to.agentId,
        toAgentName: to.agentName,
        agreement: true,
        message: `Agrees with ${to.agentName}: ${decision.toUpperCase()} thesis confirmed (${from.confidence}% confidence).`,
        timestamp: now,
      });
    }
  }

  // Loser -> winner disagreement.
  for (const loser of losers) {
    const target = winners[0];
    if (!target) continue;
    discussion.push({
      id: nextMsgId(),
      fromAgentId: loser.agentId,
      fromAgentName: loser.agentName,
      toAgentId: target.agentId,
      toAgentName: target.agentName,
      agreement: false,
      message: `Disagrees: signals ${loser.action.toUpperCase()} (${loser.confidence}% confidence) — opposes the ${decision.toUpperCase()} consensus.`,
      timestamp: now,
    });
  }

  // Holders broadcast neutral reads.
  for (const h of holders) {
    discussion.push({
      id: nextMsgId(),
      fromAgentId: h.agentId,
      fromAgentName: h.agentName,
      toAgentId: "all",
      toAgentName: "All",
      agreement: false,
      message: `Neutral read: ${h.reasoning}`,
      timestamp: now,
    });
  }

  // Specialist agents broadcast their recommended params.
  if (stopLossSig && slValue !== undefined) {
    discussion.push({
      id: nextMsgId(),
      fromAgentId: stopLossSig.agentId,
      fromAgentName: stopLossSig.agentName,
      toAgentId: "all",
      toAgentName: "All",
      agreement: true,
      message: `Specialist recommendation: stop-loss at $${slValue.toFixed(2)} for a ${decision.toUpperCase()} entry.`,
      timestamp: now,
    });
  }
  if (stopWinSig && tpValue !== undefined) {
    discussion.push({
      id: nextMsgId(),
      fromAgentId: stopWinSig.agentId,
      fromAgentName: stopWinSig.agentName,
      toAgentId: "all",
      toAgentName: "All",
      agreement: true,
      message: `Specialist recommendation: take-profit at $${tpValue.toFixed(2)} for a ${decision.toUpperCase()} entry.`,
      timestamp: now,
    });
  }
  if (riskSig && riskScore !== undefined) {
    discussion.push({
      id: nextMsgId(),
      fromAgentId: riskSig.agentId,
      fromAgentName: riskSig.agentName,
      toAgentId: "all",
      toAgentName: "All",
      agreement: riskScore < 60,
      message: `Risk assessment: market risk score ${riskScore}/100 — ${riskScore > 60 ? "elevated volatility, trade with caution" : riskScore > 30 ? "moderate risk" : "low-risk regime"}.`,
      timestamp: now,
    });
  }

  const passed =
    decision !== "hold" && totalConfidence >= CONSENSUS_THRESHOLD && totalWeight > 0;

  return {
    decision,
    totalConfidence,
    votes,
    discussion,
    threshold: CONSENSUS_THRESHOLD,
    passed,
    reason,
    executionParams,
  };
}
