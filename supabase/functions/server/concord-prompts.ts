// ============================================================
// Concord Prompt Builders — Compliance Agent
//
// Used by: /compliance-check route handler (HTTP)
//          runSettlementPipeline() inline compliance (pipeline)
//          Both call sites in index.tsx
//
// All functions are pure: data in, string out. No DB queries,
// no Gemini calls, no side effects.
// ============================================================

export interface ConcordNarrativeParams {
  networkModeContext: string;
  amountDisplay: number;
  senderName: string;
  senderCode: string;
  senderJurisdiction: string;
  receiverName: string;
  receiverCode: string;
  receiverJurisdiction: string;
  purposeCode: string | null;
  checks: { type: string; passed: boolean; detail: string }[];
  allPassed: boolean;
}

/**
 * Builds the user prompt for Concord's compliance narrative generation.
 * Called after the 6 deterministic compliance checks complete.
 *
 * The system prompt is the static CONCORD_SYSTEM_PROMPT from shared-context.ts.
 */
export function buildConcordNarrativePrompt(p: ConcordNarrativeParams): string {
  const checksText = p.checks.map(c => `- ${c.type}: ${c.passed ? 'PASSED' : 'FAILED'} — ${c.detail}`).join('\n');
  const passedCount = p.checks.filter(c => c.passed).length;

  return `You are Concord, the compliance agent for the CODA Solstice Network.
You have just completed a regulatory compliance review of an interbank settlement transaction.

${p.networkModeContext}

TRANSACTION DETAILS:
- Amount: $${(p.amountDisplay || 0).toLocaleString()}
- Sender: ${p.senderName} (${p.senderCode}), ${p.senderJurisdiction}
- Receiver: ${p.receiverName} (${p.receiverCode}), ${p.receiverJurisdiction}
- Purpose: ${p.purposeCode || 'unspecified'}

COMPLIANCE CHECK RESULTS:
${checksText}

OVERALL VERDICT: ${p.allPassed ? 'PASSED' : 'FAILED'} (${passedCount}/${p.checks.length})

Write a 2-4 sentence compliance narrative in formal regulatory language explaining your verdict.
${p.allPassed
  ? 'Explain why this transaction satisfies all regulatory requirements and is cleared to proceed to risk assessment.'
  : `Explain specifically which requirement(s) were not met and what remediation would be needed. The failed check(s): ${p.checks.filter(c => !c.passed).map(c => c.type).join(', ')}.`
}

Respond with ONLY the narrative text, no JSON, no markdown, no prefixes.`;
}

/**
 * Fallback narrative when Gemini is unavailable.
 */
export function concordNarrativeFallback(
  allPassed: boolean,
  checksTotal: number,
  failedCount: number,
): string {
  return allPassed
    ? `Transaction meets all ${checksTotal} regulatory requirements. Cleared for risk assessment.`
    : `Transaction failed ${failedCount} of ${checksTotal} regulatory checks. Review required.`;
}
