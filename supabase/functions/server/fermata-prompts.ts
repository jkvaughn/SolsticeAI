// ============================================================
// Fermata Prompt Builders — Risk Scoring Agent
//
// Used by: /risk-score route handler (HTTP)
//          runSettlementPipeline() inline risk scoring (pipeline)
//          Both call sites in index.tsx
//
// All functions are pure: data in, string out. No DB queries,
// no Gemini calls, no side effects.
// ============================================================

export interface RiskScoringPromptParams {
  networkModeContext: string;
  senderName: string;
  senderCode: string;
  senderTier: string;
  senderJurisdiction: string;
  receiverName: string;
  receiverCode: string;
  receiverTier: string;
  receiverJurisdiction: string;
  amountDisplay: number;
  purposeCode: string | null;
  memo: string | null;
  settlementType?: string;
  compliancePassed: boolean | null;
  corridorContext: string;
  senderVelocityContext: string;
  senderTxnsLast60MinCount: number;
  senderVolumeLast60Min: number;
  corridorLength: number;
  riskWeightCounterparty: number;
  riskWeightJurisdiction: number;
  riskWeightAssetType: number;
  riskWeightBehavioral: number;
}

/**
 * Builds the user prompt for Fermata's risk scoring.
 *
 * The system prompt is the static FERMATA_SYSTEM_PROMPT from shared-context.ts.
 */
export function buildRiskScoringPrompt(p: RiskScoringPromptParams): string {
  const settlementLine = p.settlementType != null
    ? `\n- Settlement type: ${p.settlementType || "tokenized_deposit"}`
    : '';

  return `${p.networkModeContext}You are a risk assessment engine for the CODA Solstice Network, a wholesale bank-to-bank settlement system on Solana.

Analyze this transaction and provide risk scores (0-100, where 0 is lowest risk and 100 is highest risk):

Transaction details:
- Sender: ${p.senderName} (${p.senderCode}), Tier: ${p.senderTier}, Jurisdiction: ${p.senderJurisdiction}
- Receiver: ${p.receiverName} (${p.receiverCode}), Tier: ${p.receiverTier}, Jurisdiction: ${p.receiverJurisdiction}
- Amount: $${p.amountDisplay?.toLocaleString()} USD
- Purpose: ${p.purposeCode || "unspecified"}
- Memo: ${p.memo || "none"}${settlementLine}
- Compliance passed: ${p.compliancePassed}

CORRIDOR HISTORY (${p.senderCode} \u2194 ${p.receiverCode}, last 10 transactions):
${p.corridorContext}

SENDER VELOCITY (${p.senderCode}, last 10 transactions across all corridors):
${p.senderVelocityContext}

VELOCITY SUMMARY:
- Transactions in last 60 minutes: ${p.senderTxnsLast60MinCount}
- Volume in last 60 minutes: $${p.senderVolumeLast60Min.toLocaleString()}
- This is ${p.corridorLength > 0 ? `transaction #${p.corridorLength + 1}` : 'the first transaction'} in this corridor.

BEHAVIORAL ANALYSIS GUIDANCE:
When scoring the "behavioral" dimension, consider:
- Is this amount consistent with the corridor's history? Sudden large jumps are higher risk.
- Is the sender showing unusual velocity? 3+ transactions in 60 minutes from the same sender is elevated.
- Is there potential structuring? Multiple transactions just below round-number thresholds suggest evasion.
- First-time corridor transactions inherently carry more counterparty uncertainty.
- Consistent, periodic settlement activity between established counterparties is LOW behavioral risk.

DIMENSION WEIGHTS (this bank's configured risk appetite):
- Counterparty: ${p.riskWeightCounterparty}
- Jurisdiction: ${p.riskWeightJurisdiction}
- Asset Type: ${p.riskWeightAssetType}
- Behavioral: ${p.riskWeightBehavioral}
Use these weights to calculate the composite_score as a weighted average of the 4 dimension scores.

Respond with JSON:
{
  "counterparty_score": number (0-100),
  "jurisdiction_score": number (0-100),
  "asset_type_score": number (0-100),
  "behavioral_score": number (0-100),
  "composite_score": number (0-100, weighted average),
  "risk_level": "low" | "medium" | "high",
  "finality_recommendation": "immediate" | "deferred_30min" | "deferred_24h" | "manual_review",
  "reasoning": "detailed explanation"
}`;
}
