/**
 * Deterministic Risk Scoring Engine (Task 153)
 *
 * Pure TypeScript — no LLM, no network calls.
 * Evaluates 13 hard-coded rules against pre-fetched transaction context.
 * Produces a floor score that constrains Fermata: final ≥ floor × 0.70
 */

export interface RiskRule {
  id: string;
  dimension: string;
  name: string;
  condition_type: string;
  condition_params: Record<string, any>;
  score_impact: number;
  override_type: string;
  active: boolean;
}

export interface RuleContext {
  amount: number;
  purposeCode: string;
  senderJurisdiction: string;
  receiverJurisdiction: string;
  senderTier: string;
  receiverTier: string;
  receiverStatus: string;
  corridorHistoryCount: number;
  corridorAvgAmount: number;
  senderTxCount60m: number;
  senderTxBelow10k24h: number;
  uniqueCounterparties30m: number;
  watchlistMatch: boolean;
  purposeCodeApproved: boolean;
}

export interface RuleEvalResult {
  floor_score: number;
  floor_breakdown: Record<string, number>;
  rules_fired: string[];
  hard_overrides: string[];
}

function evaluateRule(rule: RiskRule, ctx: RuleContext): boolean {
  switch (rule.id) {
    case 'R-001': return ctx.corridorHistoryCount === 0;
    case 'R-002': return ctx.senderTier !== ctx.receiverTier;
    case 'R-003': return ctx.senderJurisdiction !== ctx.receiverJurisdiction;
    case 'R-004': {
      const list: string[] = rule.condition_params.high_risk_list || [];
      return list.includes(ctx.senderJurisdiction) || list.includes(ctx.receiverJurisdiction);
    }
    case 'R-005': return ctx.amount >= 5_000_000;
    case 'R-006': return ctx.amount >= 25_000_000;
    case 'R-007': return ctx.senderTxCount60m > 5;
    case 'R-008': return ctx.senderTxBelow10k24h >= 3;
    case 'R-009': return ctx.corridorAvgAmount > 0 && (ctx.amount / ctx.corridorAvgAmount) >= 10;
    case 'R-011': return ctx.uniqueCounterparties30m >= 3;
    case 'R-012': return ctx.receiverStatus === 'suspended';
    case 'R-013': return ctx.watchlistMatch === true;
    case 'R-014': return ctx.purposeCodeApproved === false;
    default: return false;
  }
}

export function evaluateRules(
  ctx: RuleContext,
  rules: RiskRule[],
  weights: { counterparty: number; jurisdiction: number; asset_type: number; behavioral: number },
): RuleEvalResult {
  const dimensionScores: Record<string, number> = {
    counterparty: 0,
    jurisdiction: 0,
    asset_type: 0,
    behavioral: 0,
  };
  const rulesFired: string[] = [];
  const hardOverrides: string[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;
    if (evaluateRule(rule, ctx)) {
      rulesFired.push(rule.id);
      dimensionScores[rule.dimension] = Math.min(100, (dimensionScores[rule.dimension] || 0) + rule.score_impact);
      if (rule.override_type === 'HARD_BLOCK' || rule.override_type === 'HARD_ESCALATE') {
        hardOverrides.push(rule.id);
      }
    }
  }

  // Weighted composite (same formula as Fermata)
  const raw =
    dimensionScores.counterparty * (weights.counterparty || 0.25) +
    dimensionScores.jurisdiction * (weights.jurisdiction || 0.25) +
    dimensionScores.asset_type * (weights.asset_type || 0.25) +
    dimensionScores.behavioral * (weights.behavioral || 0.25);

  const floorScore = Math.min(100, Math.max(0, Math.round(raw * 100) / 100));

  return {
    floor_score: floorScore,
    floor_breakdown: dimensionScores,
    rules_fired: rulesFired,
    hard_overrides: hardOverrides,
  };
}
