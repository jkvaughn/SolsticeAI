import { useState } from 'react';
import {
  Link2, ExternalLink, Copy, CheckCircle2, Flame, Coins,
  ArrowRight, Clock, Shield, TrendingUp, Lock, Unlock,
  ChevronRight, Zap, CircleDollarSign, RotateCcw,
} from 'lucide-react';
import type { Transaction, AgentMessage } from '../types';
import { truncateAddress, explorerUrl, formatTokenAmount } from '../types';

// ============================================================
// Types
// ============================================================

interface LockupToken {
  id: string;
  transaction_id: string;
  yb_token_mint: string;
  yb_token_symbol: string;
  yb_token_amount: string;
  yb_holder: string;
  tb_token_mint: string | null;
  tb_token_symbol: string | null;
  tb_token_amount: string | null;
  tb_holder: string | null;
  yield_rate_bps: number;
  yield_accrued: string;
  lockup_start: string;
  lockup_end: string | null;
  status: string;
  resolution?: string | null;
  resolved_at?: string | null;
}

interface SubTx {
  step: number;
  label: string;
  annotation: string;
  status: 'complete' | 'pending' | 'active' | 'skipped' | 'reversed';
  icon: typeof Flame;
  iconColor: string;
  signature?: string;
  mint?: string;
  amount?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  details?: Record<string, string>;
}

interface SettlementLifecycleProps {
  tx: Transaction;
  lockup: LockupToken | null;
  messages: AgentMessage[];
  senderCode: string;
  receiverCode: string;
  senderMint?: string;
  receiverMint?: string;
  justTransitioned?: 'settled' | 'reversed' | null;
}

// ============================================================
// Helpers
// ============================================================

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================
// Build sub-transaction timeline from available data
// ============================================================

function buildSubTransactions(
  tx: Transaction,
  lockup: LockupToken | null,
  messages: AgentMessage[],
  senderCode: string,
  receiverCode: string,
  senderMint?: string,
  receiverMint?: string,
): SubTx[] {
  const steps: SubTx[] = [];
  const isLockup = tx.settlement_method?.includes('lockup') || tx.status === 'locked' || tx.lockup_status != null;
  const isPvP = tx.settlement_method === 'pvp_burn_mint' || (!isLockup && tx.status === 'settled');
  const isReversed = tx.status === 'reversed';
  const isLocked = tx.status === 'locked';
  const amountDisplay = tx.amount_display != null ? `$${tx.amount_display.toLocaleString()}` : formatTokenAmount(tx.amount);
  const rawAmount = tx.amount_display != null ? (tx.amount_display * 1_000_000).toString() : tx.amount?.toString() || '0';

  // Extract settlement confirm message for sub-tx signatures
  const settleMsg = messages.find(m =>
    m.message_type === 'settlement_confirm' &&
    (m.content as any)?.action === 'hard_finality'
  );
  const settleContent = (settleMsg?.content || {}) as Record<string, any>;

  // Phase 2 finality signature — prefer transactions table, fall back to agent message
  const finalitySig = tx.finality_tx_signature || settleContent.finality_signature || settleContent.deposit_mint || undefined;
  const finalitySlot = tx.finality_solana_slot || settleContent.finality_slot || undefined;

  // Extract initial settlement message
  const initialSettleMsg = messages.find(m =>
    m.message_type === 'settlement_confirm' &&
    (m.content as any)?.action !== 'hard_finality' &&
    (m.content as any)?.action !== 'reversal' &&
    (m.content as any)?.action !== 'auto_settle_expired'
  );

  // Reversal message
  const reversalMsg = messages.find(m =>
    m.message_type === 'settlement_confirm' &&
    (m.content as any)?.flow === 'lockup_reverse'
  );
  const reversalContent = (reversalMsg?.content || {}) as Record<string, any>;

  let stepNum = 1;

  // ── Step 1: Burn Sender Tokens ──
  const senderSymbol = `${senderCode}-USTB`;
  steps.push({
    step: stepNum++,
    label: `Burn ${senderSymbol}`,
    annotation: `Sender's deposit tokens are burned from ${senderCode}'s wallet, removing the tokens from circulation. This is the debit leg of the interbank settlement.`,
    status: tx.solana_tx_signature ? 'complete' : tx.status === 'executing' ? 'active' : 'pending',
    icon: Flame,
    iconColor: 'text-orange-400',
    signature: tx.solana_tx_signature || undefined,
    mint: senderMint,
    amount: amountDisplay,
    from: `${senderCode} Wallet`,
    to: 'Burned (supply reduction)',
    timestamp: tx.initiated_at || tx.created_at,
    details: senderMint ? { 'Token Mint': truncateAddress(senderMint, 8) } : undefined,
  });

  if (isLockup && lockup) {
    // ── Phase 1 Step 2: Mint LOCKUP-USTB to BNY Escrow ──
    const lockupSymbol = lockup.yb_token_symbol || 'LOCKUP-USTB';
    steps.push({
      step: stepNum++,
      label: `Mint ${lockupSymbol} to Escrow`,
      annotation: `Lockup tokens are minted to the BNY Mellon custodian's escrow wallet. These tokens represent the locked funds and accrue yield at ${((lockup.yield_rate_bps || 525) / 100).toFixed(2)}% APY. The receiver has NO tokens at this point \u2014 funds are held in escrow until finality.`,
      status: tx.solana_tx_signature ? 'complete' : 'pending',
      icon: Lock,
      iconColor: 'text-purple-400',
      mint: lockup.yb_token_mint,
      amount: formatTokenAmount(lockup.yb_token_amount),
      from: 'Token Program (Phase 1)',
      to: `BNY Escrow (${truncateAddress(lockup.yb_holder, 6)})`,
      timestamp: lockup.lockup_start || tx.initiated_at || undefined,
      details: {
        'Lockup Mint': truncateAddress(lockup.yb_token_mint, 8),
        'Yield Rate': `${((lockup.yield_rate_bps || 525) / 100).toFixed(2)}% APY`,
        'Escrow Holder': truncateAddress(lockup.yb_holder, 8),
      },
    });

    // ── Phase 1 Step 3: Network Fee #1 ──
    steps.push({
      step: stepNum++,
      label: 'Network Fee #1',
      annotation: `Phase 1 network fee (0.001 SOL) is collected from the sender bank's wallet for the escrow-in operation.`,
      status: tx.solana_tx_signature ? 'complete' : 'pending',
      icon: Coins,
      iconColor: 'text-amber-400',
      amount: '0.001 SOL',
      from: `${senderCode} Wallet`,
      to: 'Solstice Fees (Phase 1)',
      timestamp: tx.initiated_at || tx.created_at,
    });

    // ── Step 4: Lockup Hold Period (Cadenza Monitoring) ──
    const lockupDuration = tx.lockup_duration_minutes || 0;
    const lockupEnd = lockup.lockup_end;
    const lockupExpired = lockupEnd ? new Date(lockupEnd).getTime() <= Date.now() : false;
    const isSettled = tx.status === 'settled';
    const lockupStatus: SubTx['status'] = isSettled || isReversed ? 'complete' : lockupExpired ? 'complete' : 'active';

    steps.push({
      step: stepNum++,
      label: 'Lockup Hold Period',
      annotation: `Funds are held in escrow while Cadenza AI monitors the transaction for anomalies. The monitoring period was ${lockupDuration > 0 ? `${lockupDuration} minutes` : 'risk-determined'}. ${lockup.status === 'escalated' ? 'This lockup was escalated to human review due to detected anomalies.' : lockupExpired ? 'The lockup period has concluded successfully.' : 'Monitoring is currently active.'}`,
      status: lockupStatus,
      icon: Lock,
      iconColor: lockup.status === 'escalated' ? 'text-red-400' : 'text-amber-400',
      amount: formatTokenAmount(lockup.yield_accrued) !== '$0.00' ? `${formatTokenAmount(lockup.yield_accrued)} yield accrued` : undefined,
      from: lockup.lockup_start ? fmtDate(lockup.lockup_start) : undefined,
      to: lockup.lockup_end ? fmtDate(lockup.lockup_end) : (lockup.status === 'escalated' ? '\u221e (escalated)' : 'Pending'),
      details: {
        'Cadenza Status': lockup.status.charAt(0).toUpperCase() + lockup.status.slice(1),
        'Yield Accrued': formatTokenAmount(lockup.yield_accrued),
        ...(lockup.resolution ? { 'Resolution': lockup.resolution.replace(/_/g, ' ') } : {}),
      },
    });

    if (isReversed) {
      // ── Reversal: Burn LOCKUP-USTB from escrow ──
      steps.push({
        step: stepNum++,
        label: `Burn ${lockupSymbol} from Escrow`,
        annotation: `The lockup tokens are burned from the BNY custodian's escrow wallet, releasing the held funds. Since the receiver never had any tokens, this is a clean reversal with no adversarial clawback.`,
        status: 'reversed',
        icon: Flame,
        iconColor: 'text-red-400',
        signature: reversalContent.escrow_burn || reversalContent.yb_burn || undefined,
        amount: formatTokenAmount(lockup.yb_token_amount),
        from: 'BNY Escrow',
        to: 'Burned (reversal)',
        timestamp: reversalMsg?.created_at,
      });

      steps.push({
        step: stepNum++,
        label: `Refund ${senderSymbol} to ${senderCode}`,
        annotation: `The original sender's deposit tokens are re-minted, returning the full principal to ${senderCode}. The receiver never had any tokens \u2014 this is a cryptographically clean reversal.`,
        status: 'reversed',
        icon: RotateCcw,
        iconColor: 'text-red-400',
        signature: reversalContent.sender_remint || reversalContent.sender_refund_mint || undefined,
        amount: amountDisplay,
        from: 'Token Program',
        to: `${senderCode} Wallet`,
        timestamp: reversalMsg?.created_at,
      });
    } else {
      // ── Phase 2 Step 5: Burn LOCKUP-USTB from Escrow ──
      steps.push({
        step: stepNum++,
        label: `Burn ${lockupSymbol} from Escrow`,
        annotation: `Upon lockup expiry or Cadenza clearance, the lockup tokens are burned from the BNY custodian's escrow wallet. This releases the held funds for final minting to the receiver.`,
        status: isSettled ? 'complete' : 'pending',
        icon: Flame,
        iconColor: 'text-emerald-400',
        signature: settleContent.escrow_burn || settleContent.yb_burn || undefined,
        amount: formatTokenAmount(lockup.yb_token_amount),
        from: 'BNY Escrow',
        to: 'Burned (Phase 2)',
        timestamp: isSettled ? (lockup.resolved_at || tx.settled_at || undefined) : undefined,
      });

      // ── Phase 2 Step 6: Mint Receiver Deposit Token ──
      const receiverSymbol = `${receiverCode}-USTB`;
      steps.push({
        step: stepNum++,
        label: `Mint ${receiverSymbol}`,
        annotation: `Receiver's deposit tokens are minted for the first time. This is the credit leg of the settlement \u2014 ${receiverCode} now irrevocably owns the funds. This only happens after the lockup period concludes successfully.`,
        status: isSettled ? 'complete' : 'pending',
        icon: CircleDollarSign,
        iconColor: 'text-emerald-400',
        signature: finalitySig || undefined,
        mint: receiverMint,
        amount: amountDisplay,
        from: 'Token Program (Phase 2)',
        to: `${receiverCode} Wallet`,
        timestamp: isSettled ? (tx.settled_at || undefined) : undefined,
      });

      // ── Phase 2 Step 7: Network Fee #2 ──
      steps.push({
        step: stepNum++,
        label: 'Network Fee #2',
        annotation: `Phase 2 network fee (0.001 SOL) is collected for the escrow-out and receiver minting operation. Total lockup settlement cost: 0.002 SOL (Phase 1 + Phase 2).`,
        status: isSettled ? 'complete' : 'pending',
        icon: Coins,
        iconColor: 'text-amber-400',
        amount: '0.001 SOL',
        from: `${senderCode} Wallet`,
        to: 'Solstice Fees (Phase 2)',
        timestamp: isSettled ? (tx.settled_at || undefined) : undefined,
      });

      // ── Step 8: Yield Sweep ──
      if (settleContent.yield_swept || lockup.yield_accrued !== '0') {
        steps.push({
          step: stepNum++,
          label: 'Yield Sweep',
          annotation: `Accrued yield from the lockup period is swept to the Solstice network fees wallet. This yield compensates the network for providing the reversibility guarantee during the lockup window.`,
          status: isSettled ? 'complete' : 'pending',
          icon: TrendingUp,
          iconColor: 'text-teal-400',
          amount: settleContent.yield_swept || formatTokenAmount(lockup.yield_accrued),
          from: 'Lockup Token Yield',
          to: 'Solstice Fees Wallet',
          timestamp: isSettled ? (tx.settled_at || undefined) : undefined,
        });
      }
    }
  } else if (isLockup && !lockup) {
    // ── Legacy inline lockup (pre-Task 118) ──
    // For backward compatibility with transactions created before true three-token model
    const receiverSymbol = `${receiverCode}-USTB`;
    steps.push({
      step: stepNum++,
      label: `Mint ${receiverSymbol}`,
      annotation: `Receiver's deposit tokens were minted in the initial on-chain transaction. This is a legacy inline lockup \u2014 newer transactions use the true three-token escrow model.`,
      status: tx.solana_tx_signature ? 'complete' : 'pending',
      icon: CircleDollarSign,
      iconColor: 'text-emerald-400',
      signature: tx.solana_tx_signature || undefined,
      mint: receiverMint,
      amount: amountDisplay,
      from: 'Token Program',
      to: `${receiverCode} Wallet`,
      timestamp: tx.initiated_at || tx.created_at,
    });

    const lockupUntil = tx.lockup_until;
    const lockupExpired = lockupUntil ? new Date(lockupUntil).getTime() <= Date.now() : false;
    steps.push({
      step: stepNum++,
      label: 'Status Hold Period',
      annotation: `Settlement status is held as "locked" until the timer expires. ${lockupExpired ? 'The hold period has concluded.' : 'The hold period is currently active.'}`,
      status: tx.status === 'settled' ? 'complete' : lockupExpired ? 'complete' : 'active',
      icon: Lock,
      iconColor: 'text-amber-400',
      from: fmtDate(tx.initiated_at || tx.created_at),
      to: lockupUntil ? fmtDate(lockupUntil) : 'Pending',
      details: {
        'Duration': tx.lockup_duration_minutes ? `${tx.lockup_duration_minutes} min` : 'Risk-determined',
      },
    });

    // Final status update
    steps.push({
      step: stepNum++,
      label: 'Hard Finality',
      annotation: `The transaction transitions from "locked" to "settled" once the hold period expires. No additional on-chain operations are needed \u2014 this is a database status update confirming irrevocable settlement.`,
      status: tx.status === 'settled' ? 'complete' : 'pending',
      icon: Unlock,
      iconColor: 'text-emerald-400',
      timestamp: tx.settled_at || undefined,
    });
  } else {
    // ── PvP (Burn-Mint) ──
    const receiverSymbol = `${receiverCode}-USTB`;
    steps.push({
      step: stepNum++,
      label: `Mint ${receiverSymbol}`,
      annotation: `Receiver's deposit tokens are atomically minted in the same on-chain transaction as the sender burn. This PvP (Payment vs Payment) swap ensures neither party bears counterparty risk \u2014 both legs execute or neither does.`,
      status: tx.solana_tx_signature ? 'complete' : 'pending',
      icon: CircleDollarSign,
      iconColor: 'text-emerald-400',
      signature: tx.solana_tx_signature || undefined,
      mint: receiverMint,
      amount: amountDisplay,
      from: 'Token Program',
      to: `${receiverCode} Wallet`,
      timestamp: tx.settled_at || tx.initiated_at || tx.created_at,
    });

    // ── Network Fee (PvP only — lockup fees are inline as Phase 1 + Phase 2) ──
    if (!isLockup && tx.network_fee_sol != null && tx.network_fee_sol > 0) {
      steps.push({
        step: stepNum++,
        label: 'Network Fee',
        annotation: `A ${tx.network_fee_sol} SOL gas-layer fee is transferred from the sender bank's wallet to the Solstice network fees wallet. This covers Solana transaction costs and network operation.`,
        status: tx.solana_tx_signature ? 'complete' : 'pending',
        icon: Coins,
        iconColor: 'text-amber-400',
        amount: `${tx.network_fee_sol} SOL`,
        from: `${senderCode} Wallet`,
        to: 'Solstice Fees',
        timestamp: tx.settled_at || tx.initiated_at || undefined,
      });
    }
  }

  return steps;
}

// ============================================================
// Component
// ============================================================

export function SettlementLifecycle({ tx, lockup, messages, senderCode, receiverCode, senderMint, receiverMint, justTransitioned }: SettlementLifecycleProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const subTxs = buildSubTransactions(tx, lockup, messages, senderCode, receiverCode, senderMint, receiverMint);

  const statusIcon = (status: SubTx['status']) => {
    switch (status) {
      case 'complete': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'active': return <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />;
      case 'pending': return <div className="w-4 h-4 rounded-full border-2 border-coda-border/40" />;
      case 'reversed': return <RotateCcw className="w-4 h-4 text-red-400" />;
      case 'skipped': return <div className="w-4 h-4 rounded-full bg-coda-surface-hover/40" />;
    }
  };

  const statusBg = (status: SubTx['status']) => {
    switch (status) {
      case 'complete': return 'bg-emerald-500/10 border-emerald-500/20';
      case 'active': return 'bg-amber-500/10 border-amber-500/20';
      case 'pending': return 'bg-coda-surface-hover/20 border-coda-border/10';
      case 'reversed': return 'bg-red-500/10 border-red-500/20';
      case 'skipped': return 'bg-coda-surface-hover/10 border-coda-border/10';
    }
  };

  const lineColor = (status: SubTx['status']) => {
    switch (status) {
      case 'complete': return 'bg-emerald-500/40';
      case 'active': return 'bg-amber-500/40';
      case 'reversed': return 'bg-red-500/40';
      default: return 'bg-coda-border/20';
    }
  };

  return (
    <div className={`liquid-glass-subtle squircle-sm p-6 mb-5 transition-all duration-700 ${
      justTransitioned === 'settled' ? 'ring-1 ring-emerald-500/25 shadow-[0_0_30px_rgba(52,211,153,0.08)]' :
      justTransitioned === 'reversed' ? 'ring-1 ring-red-500/25 shadow-[0_0_30px_rgba(248,113,113,0.08)]' : ''
    }`}>
      <h3 className="text-xs tracking-wider uppercase text-coda-text-secondary font-mono mb-2 flex items-center gap-2">
        <Link2 className="w-5 h-5" />
        Settlement Lifecycle
        <span className="ml-1 text-coda-text-muted">{subTxs.length} sub-transactions</span>
        {tx.settlement_method && (
          <span className={`ml-auto text-[10px] font-semibold tracking-wider uppercase px-2.5 py-1 rounded-full ${
            tx.settlement_method === 'pvp_burn_mint' ? 'bg-teal-500/20 text-teal-400' :
            tx.settlement_method === 'lockup_hard_finality' ? 'bg-emerald-500/20 text-emerald-400' :
            tx.settlement_method?.includes('reversal') ? 'bg-red-500/20 text-red-400' :
            tx.settlement_method?.includes('lockup') ? 'bg-purple-500/20 text-purple-400' :
            'bg-coda-text-muted/20 text-coda-text-muted'
          }`}>
            {tx.settlement_method === 'pvp_burn_mint' ? 'PvP Burn-Mint' :
             tx.settlement_method === 'lockup_hard_finality' ? 'Lockup \u2192 Finality' :
             tx.settlement_method === 'lockup_reversal' ? 'Auto Reversal' :
             tx.settlement_method === 'lockup_user_reversal' ? 'User Reversal' :
             tx.settlement_method === 'lockup_three_token' ? 'Three-Token Lockup' :
             tx.settlement_method}
          </span>
        )}
      </h3>

      {/* Flow description */}
      <p className="text-[11px] text-coda-text-muted font-mono mb-5 leading-relaxed">
        {tx.settlement_method?.includes('lockup') && lockup
          ? 'True three-token lockup: Phase 1 burns sender tokens and mints LOCKUP-USTB to BNY escrow. Phase 2 (at finality) burns escrow tokens and mints receiver deposit tokens. Receiver gets nothing until Phase 2.'
          : tx.settlement_method?.includes('lockup') && !lockup
          ? 'Legacy inline lockup: atomic PvP burn-mint on-chain with status hold period for reversibility.'
          : 'PvP atomic settlement: sender tokens burned and receiver tokens minted in a single on-chain transaction.'}
      </p>

      {/* Timeline */}
      <div className="relative">
        {subTxs.map((step, idx) => {
          const isLast = idx === subTxs.length - 1;
          const isExpanded = expandedStep === idx;
          const StepIcon = step.icon;

          return (
            <div key={step.step} className="relative flex gap-4">
              {/* Vertical timeline line + dot */}
              <div className="flex flex-col items-center shrink-0">
                {/* Status icon */}
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${statusBg(step.status)} z-10`}>
                  <StepIcon className={`w-4 h-4 ${step.iconColor}`} />
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div className={`w-0.5 flex-1 min-h-[16px] ${lineColor(step.status)}`} />
                )}
              </div>

              {/* Content */}
              <div className={`flex-1 pb-5 ${isLast ? 'pb-0' : ''}`}>
                {/* Header row */}
                <button
                  onClick={() => setExpandedStep(isExpanded ? null : idx)}
                  className="w-full text-left flex items-center gap-2 group"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] font-mono text-coda-text-muted w-4 shrink-0">#{step.step}</span>
                    <span className="text-[13px] font-semibold font-mono text-coda-text truncate">{step.label}</span>
                    {statusIcon(step.status)}
                    {step.amount && (
                      <span className="text-[11px] font-mono text-coda-text-secondary ml-1">{step.amount}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {step.timestamp && (
                      <span className="text-[10px] font-mono text-coda-text-muted hidden sm:block">
                        {fmtDate(step.timestamp)}
                      </span>
                    )}
                    <ChevronRight className={`w-3.5 h-3.5 text-coda-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>
                </button>

                {/* Annotation (always visible) */}
                <p className="text-[11px] text-coda-text-muted font-mono mt-1 leading-relaxed pr-4 max-w-2xl">
                  {step.annotation}
                </p>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="mt-3 space-y-2.5">
                    {/* From → To */}
                    {(step.from || step.to) && (
                      <div className="flex items-center gap-2 text-[11px] font-mono">
                        {step.from && (
                          <span className="text-coda-text-secondary bg-coda-surface-hover/30 px-2 py-0.5 rounded">{step.from}</span>
                        )}
                        {step.from && step.to && <ArrowRight className="w-3 h-3 text-coda-text-muted" />}
                        {step.to && (
                          <span className="text-coda-text-secondary bg-coda-surface-hover/30 px-2 py-0.5 rounded">{step.to}</span>
                        )}
                      </div>
                    )}

                    {/* Signature */}
                    {step.signature && (
                      <div className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="text-coda-text-muted w-12 shrink-0">Sig:</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyText(step.signature!, `sig-${step.step}`); }}
                          className="text-coda-text-secondary hover:text-coda-text transition-colors flex items-center gap-1"
                        >
                          {truncateAddress(step.signature, 10)}
                          {copied === `sig-${step.step}` ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-2.5 h-2.5" />}
                        </button>
                        <a
                          href={explorerUrl(step.signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-400 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}

                    {/* Mint */}
                    {step.mint && (
                      <div className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="text-coda-text-muted w-12 shrink-0">Mint:</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyText(step.mint!, `mint-${step.step}`); }}
                          className="text-coda-text-secondary hover:text-coda-text transition-colors flex items-center gap-1"
                        >
                          {truncateAddress(step.mint, 10)}
                          {copied === `mint-${step.step}` ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-2.5 h-2.5" />}
                        </button>
                      </div>
                    )}

                    {/* Extra details */}
                    {step.details && Object.keys(step.details).length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-1">
                        {Object.entries(step.details).map(([k, v]) => (
                          <div key={k} className="text-[10px] font-mono">
                            <span className="text-coda-text-muted uppercase tracking-wider">{k}</span>
                            <div className="text-coda-text-secondary mt-0.5">{v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall settlement summary bar */}
      {tx.solana_tx_signature && (
        <div className="mt-5 pt-4 border-t border-white/10">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
              <Zap className="w-3.5 h-3.5 text-coda-text-muted" />
              <span className="text-coda-text-muted">Phase 1 Sig:</span>
              <button
                onClick={() => copyText(tx.solana_tx_signature!, 'primary-sig')}
                className="hover:text-coda-text-secondary transition-colors flex items-center gap-1"
              >
                {truncateAddress(tx.solana_tx_signature, 10)}
                {copied === 'primary-sig' ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-2.5 h-2.5" />}
              </button>
              <a href={explorerUrl(tx.solana_tx_signature)} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400">
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {tx.finality_tx_signature && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
                <span className="text-coda-text-muted">Phase 2 Sig:</span>
                <button
                  onClick={() => copyText(tx.finality_tx_signature!, 'finality-sig')}
                  className="hover:text-coda-text-secondary transition-colors flex items-center gap-1"
                >
                  {truncateAddress(tx.finality_tx_signature, 10)}
                  {copied === 'finality-sig' ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-2.5 h-2.5" />}
                </button>
                <a href={explorerUrl(tx.finality_tx_signature)} target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400">
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
            {tx.solana_slot && (
              <div className="text-[11px] font-mono text-coda-text-muted">
                Slot: <span className="text-coda-text-secondary">{tx.solana_slot.toLocaleString()}</span>
              </div>
            )}
            {tx.network_fee_sol != null && tx.network_fee_sol > 0 && (
              <div className="text-[11px] font-mono text-amber-400/70 flex items-center gap-1">
                <Coins className="w-3 h-3" />
                {tx.network_fee_sol} SOL fee
              </div>
            )}
            {tx.settled_at && (
              <div className="text-[11px] font-mono text-coda-text-muted ml-auto">
                Settled: <span className="text-coda-text-secondary">{fmtDate(tx.settled_at)}</span>
              </div>
            )}
          </div>

          {/* Collapsible settlement memo */}
          {tx.settlement_memo && (
            <details className="mt-3 group">
              <summary className="text-[11px] uppercase tracking-wider text-coda-text-muted font-mono cursor-pointer hover:text-coda-text-secondary transition-colors flex items-center gap-1.5 select-none">
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                Settlement Memo (ISO 20022)
              </summary>
              <pre className="mt-3 text-[12px] font-mono text-coda-text-secondary bg-black/20 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed border border-white/10">
                {tx.settlement_memo}
              </pre>
            </details>
          )}
        </div>
      )}

      {!tx.solana_tx_signature && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <p className="text-[12px] text-coda-text-muted font-mono flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            Awaiting on-chain settlement...
          </p>
        </div>
      )}
    </div>
  );
}