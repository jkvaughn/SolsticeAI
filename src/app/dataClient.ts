// ============================================================
// Data Client — environment-aware data access layer
//
// Production (VITE_SERVER_BASE_URL set):
//   Reads via REST GET endpoints on Azure Container Apps
//   (no Supabase dependency for reads).
//
// Staging / Dev (no VITE_SERVER_BASE_URL):
//   Reads via Supabase client directly.
// ============================================================

import { supabase, serverBaseUrl } from './supabaseClient';

// If VITE_SERVER_BASE_URL is set, we're in production — use REST endpoints.
const useServer = !!import.meta.env.VITE_SERVER_BASE_URL;

// Derive the data API base from the server URL.
// REST data endpoints are at /make-server-49d15288/data/...
const dataBaseUrl = useServer
  ? `${serverBaseUrl}/data`
  : null;

// ── Generic fetch helper (production path) ──────────────────

async function serverGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${dataBaseUrl}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Data fetch error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ── Typed query functions ───────────────────────────────────

export async function fetchBanks(): Promise<any[]> {
  if (useServer) return serverGet('/banks');
  const { data, error } = await supabase
    .from('banks')
    .select('*, wallets(*)')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function fetchBank(id: string): Promise<any> {
  if (useServer) return serverGet(`/banks/${id}`);
  const { data, error } = await supabase
    .from('banks')
    .select('*, wallets(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchTransactions(params?: {
  bank_id?: string;
  status?: string;
  limit?: number;
  since?: string;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.bank_id) p.bank_id = params.bank_id;
    if (params?.status) p.status = params.status;
    if (params?.limit) p.limit = String(params.limit);
    if (params?.since) p.since = params.since;
    return serverGet('/transactions', p);
  }
  let q = supabase.from('transactions').select('*, sender_bank:banks!transactions_sender_bank_id_fkey(id, short_code, name), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, short_code, name)').order('created_at', { ascending: false });
  if (params?.bank_id) q = q.or(`sender_bank_id.eq.${params.bank_id},receiver_bank_id.eq.${params.bank_id}`);
  if (params?.status) q = q.eq('status', params.status);
  if (params?.limit) q = q.limit(params.limit);
  if (params?.since) q = q.gte('created_at', params.since);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchTransaction(id: string): Promise<any> {
  if (useServer) return serverGet(`/transactions/${id}`);
  const { data, error } = await supabase.from('transactions').select('*, sender_bank:banks!transactions_sender_bank_id_fkey(id, short_code, name), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, short_code, name)').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function fetchAgentMessages(params?: {
  transaction_id?: string;
  bank_id?: string;
  limit?: number;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.transaction_id) p.transaction_id = params.transaction_id;
    if (params?.bank_id) p.bank_id = params.bank_id;
    if (params?.limit) p.limit = String(params.limit);
    return serverGet('/agent-messages', p);
  }
  let q = supabase.from('agent_messages').select('*').order('created_at', { ascending: false });
  if (params?.transaction_id) q = q.eq('transaction_id', params.transaction_id);
  if (params?.limit) q = q.limit(params.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchAgentConversations(params?: {
  bank_id?: string;
  transaction_id?: string;
  limit?: number;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.bank_id) p.bank_id = params.bank_id;
    if (params?.transaction_id) p.transaction_id = params.transaction_id;
    if (params?.limit) p.limit = String(params.limit);
    return serverGet('/agent-conversations', p);
  }
  let q = supabase.from('agent_conversations').select('*').order('created_at', { ascending: false });
  if (params?.bank_id) q = q.eq('bank_id', params.bank_id);
  if (params?.transaction_id) q = q.eq('transaction_id', params.transaction_id);
  if (params?.limit) q = q.limit(params.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchComplianceLogs(txId: string): Promise<any[]> {
  if (useServer) return serverGet('/compliance-logs', { transaction_id: txId });
  const { data, error } = await supabase.from('compliance_logs').select('*').eq('transaction_id', txId).order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function fetchRiskScore(txId: string): Promise<any | null> {
  if (useServer) return serverGet('/risk-scores', { transaction_id: txId });
  const { data, error } = await supabase.from('risk_scores').select('*').eq('transaction_id', txId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchCadenzaFlags(params?: {
  transaction_id?: string;
  action_taken_null?: boolean;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.transaction_id) p.transaction_id = params.transaction_id;
    if (params?.action_taken_null) p.action_taken = 'null';
    return serverGet('/cadenza-flags', p);
  }
  let q = supabase.from('cadenza_flags').select('*').order('detected_at', { ascending: false });
  if (params?.transaction_id) q = q.eq('transaction_id', params.transaction_id);
  if (params?.action_taken_null) q = q.is('action_taken', null);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchLockupTokens(params?: {
  status?: string;
  transaction_id?: string;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.status) p.status = params.status;
    if (params?.transaction_id) p.transaction_id = params.transaction_id;
    return serverGet('/lockup-tokens', p);
  }
  let q = supabase.from('lockup_tokens').select('*').order('created_at', { ascending: false });
  if (params?.status) q = q.eq('status', params.status);
  if (params?.transaction_id) q = q.eq('transaction_id', params.transaction_id);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchLockupToken(txId: string): Promise<any | null> {
  if (useServer) {
    const result = await serverGet('/lockup-tokens', { transaction_id: txId });
    return result;
  }
  const { data, error } = await supabase.from('lockup_tokens').select('*').eq('transaction_id', txId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchHeartbeatCycles(limit = 50): Promise<any[]> {
  if (useServer) return serverGet('/heartbeat-cycles', { limit: String(limit) });
  const { data, error } = await supabase.from('heartbeat_cycles').select('*').order('cycle_number', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchTreasuryMandates(bankId?: string): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (bankId) p.bank_id = bankId;
    return serverGet('/treasury-mandates', p);
  }
  let q = supabase.from('treasury_mandates').select('*').eq('is_active', true).order('priority');
  if (bankId) q = q.eq('bank_id', bankId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchBankAgentConfig(bankId: string): Promise<any | null> {
  if (useServer) return serverGet('/bank-agent-config', { bank_id: bankId });
  const { data, error } = await supabase.from('bank_agent_config').select('*').eq('bank_id', bankId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchNetworkWallets(): Promise<any[]> {
  if (useServer) return serverGet('/network-wallets');
  const { data, error } = await supabase.from('network_wallets').select('*').order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function fetchNetworkSnapshots(limit = 20): Promise<any[]> {
  if (useServer) return serverGet('/network-snapshots', { limit: String(limit) });
  const { data, error } = await supabase.from('network_snapshots').select('*').order('timestamp', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchSimulatedWatchlist(): Promise<any[]> {
  if (useServer) return serverGet('/simulated-watchlist');
  const { data, error } = await supabase.from('simulated_watchlist').select('*').eq('status', 'active');
  if (error) throw error;
  return data ?? [];
}

export async function fetchWallets(bankId?: string): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (bankId) p.bank_id = bankId;
    return serverGet('/wallets', p);
  }
  let q = supabase.from('wallets').select('*').order('created_at');
  if (bankId) q = q.eq('bank_id', bankId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchCorridorTransactions(
  senderBankId: string,
  receiverBankId: string,
  excludeTxId: string,
  limit = 10
): Promise<any[]> {
  if (useServer) {
    return serverGet('/corridor-transactions', {
      sender_bank_id: senderBankId,
      receiver_bank_id: receiverBankId,
      exclude_tx_id: excludeTxId,
      limit: String(limit),
    });
  }
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount_display, status, purpose_code, risk_level, created_at, solana_tx_signature')
    .or(
      `and(sender_bank_id.eq.${senderBankId},receiver_bank_id.eq.${receiverBankId}),and(sender_bank_id.eq.${receiverBankId},receiver_bank_id.eq.${senderBankId})`
    )
    .neq('id', excludeTxId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchCorridorTransactionCount(
  startTime: string,
  endTime: string
): Promise<number> {
  if (useServer) {
    const result = await serverGet<{ count: number }>('/corridor-transaction-count', {
      start: startTime,
      end: endTime,
    });
    return result.count;
  }
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startTime)
    .lte('created_at', endTime);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchTransactionCount(params?: {
  status?: string;
  statuses?: string[];   // .in() filter
  resolved_by_like?: string;  // .like() filter
}): Promise<number> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.status) p.status = params.status;
    if (params?.statuses) p.statuses = params.statuses.join(',');
    const result = await serverGet<{ count: number }>('/transaction-count', p);
    return result.count;
  }
  let q = supabase.from('transactions').select('id', { count: 'exact', head: true });
  if (params?.status) q = q.eq('status', params.status);
  if (params?.statuses) q = q.in('status', params.statuses);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function fetchSettledVolume(): Promise<number> {
  if (useServer) {
    const result = await serverGet<{ volume: number }>('/settled-volume');
    return result.volume;
  }
  const { data, error } = await supabase
    .from('transactions')
    .select('amount_display')
    .eq('status', 'settled');
  if (error) throw error;
  return (data ?? []).reduce(
    (sum: number, t: { amount_display: number | null }) => sum + (t.amount_display || 0),
    0,
  );
}

export async function fetchLockupTokenCount(params?: {
  status?: string;
  statuses?: string[];
  resolved_by_like?: string;
  updated_since?: string;
}): Promise<number> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.status) p.status = params.status;
    if (params?.statuses) p.statuses = params.statuses.join(',');
    if (params?.resolved_by_like) p.resolved_by_like = params.resolved_by_like;
    if (params?.updated_since) p.updated_since = params.updated_since;
    const result = await serverGet<{ count: number }>('/lockup-token-count', p);
    return result.count;
  }
  let q = supabase.from('lockup_tokens').select('id', { count: 'exact', head: true });
  if (params?.status) q = q.eq('status', params.status);
  if (params?.statuses) q = q.in('status', params.statuses);
  if (params?.resolved_by_like) q = q.like('resolved_by', params.resolved_by_like);
  if (params?.updated_since) q = q.gte('updated_at', params.updated_since);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function fetchCadenzaFlagCount(): Promise<number> {
  if (useServer) {
    const result = await serverGet<{ count: number }>('/cadenza-flag-count');
    return result.count;
  }
  const { count, error } = await supabase
    .from('cadenza_flags')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function fetchSettledVolumeRaw(): Promise<number> {
  if (useServer) {
    const result = await serverGet<{ volume: number }>('/settled-volume-raw');
    return result.volume;
  }
  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('status', 'settled');
  if (error) throw error;
  return (data ?? []).reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0);
}

export async function fetchTransactionsInWindow(
  windowStart: string,
  windowEnd: string,
): Promise<any[]> {
  if (useServer) {
    return serverGet('/transactions-in-window', { start: windowStart, end: windowEnd });
  }
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount_display, amount, status, purpose_code, sender_bank_id, receiver_bank_id, created_at, sender_bank:banks!transactions_sender_bank_id_fkey(short_code), receiver_bank:banks!transactions_receiver_bank_id_fkey(short_code)')
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAgentMessagesInWindow(
  windowStart: string,
  windowEnd: string,
  messageType?: string,
): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = { start: windowStart, end: windowEnd };
    if (messageType) p.message_type = messageType;
    return serverGet('/agent-messages-in-window', p);
  }
  let q = supabase
    .from('agent_messages')
    .select('id, from_bank_id, content, natural_language, created_at, from_bank:banks!agent_messages_from_bank_id_fkey(short_code)')
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('created_at', { ascending: true });
  if (messageType) q = q.eq('message_type', messageType);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchAgentMessagesWithBanks(params?: {
  limit?: number;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.limit) p.limit = String(params.limit);
    return serverGet('/agent-messages-with-banks', p);
  }
  let q = supabase
    .from('agent_messages')
    .select('id, from_bank_id, to_bank_id, message_type, content, natural_language, created_at, from_bank:banks!agent_messages_from_bank_id_fkey(short_code), to_bank:banks!agent_messages_to_bank_id_fkey(short_code)')
    .order('created_at', { ascending: false });
  if (params?.limit) q = q.limit(params.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchResolvedEscalations(limit = 5): Promise<any[]> {
  if (useServer) {
    return serverGet('/resolved-escalations', { limit: String(limit) });
  }
  const { data, error } = await supabase
    .from('lockup_tokens')
    .select('id, transaction_id, sender_bank_id, receiver_bank_id, resolution, resolved_at')
    .like('resolved_by', 'operator:%')
    .order('resolved_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ── Task 164: Compliance Filings + Unified Alerts ─────────

export async function fetchComplianceFilings(params?: {
  status?: string;
  bank_id?: string;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.status) p.status = params.status;
    if (params?.bank_id) p.bank_id = params.bank_id;
    return serverGet('/compliance-filings', p);
  }
  let q = supabase.from('compliance_filings').select('*').order('created_at', { ascending: false });
  if (params?.status) q = q.eq('status', params.status);
  if (params?.bank_id) q = q.eq('bank_id', params.bank_id);
  const { data, error } = await q.limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function fetchUnifiedAlerts(params?: {
  resolved?: boolean;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.resolved !== undefined) p.resolved = String(params.resolved);
    return serverGet('/unified-alerts', p);
  }
  let q = supabase.from('unified_alerts').select('*').order('created_at', { ascending: false });
  if (params?.resolved !== undefined) q = q.eq('resolved', params.resolved);
  const { data, error } = await q.limit(100);
  if (error) throw error;
  return data ?? [];
}

// ── Task 165: Custody + Proof of Reserves ─────────────────

export async function fetchCustodyBalances(bankId?: string): Promise<any> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (bankId) p.bank_id = bankId;
    return serverGet('/custody-balances', p);
  }
  // Staging fallback: return mock data directly
  return {
    bank_id: bankId || 'default',
    balances: [
      { asset_type: 'BTC', balance: 12.5, usd_equivalent: 812500 },
      { asset_type: 'ETH', balance: 250.0, usd_equivalent: 500000 },
      { asset_type: 'USDC', balance: 2000000, usd_equivalent: 2000000 },
    ],
    provider: 'mock',
  };
}

export async function fetchProofOfReserves(params?: {
  bank_id?: string;
}): Promise<any[]> {
  if (useServer) {
    const p: Record<string, string> = {};
    if (params?.bank_id) p.bank_id = params.bank_id;
    return serverGet('/proof-of-reserves', p);
  }
  let q = supabase.from('proof_of_reserves').select('*').order('fetched_at', { ascending: false });
  if (params?.bank_id) q = q.eq('bank_id', params.bank_id);
  const { data, error } = await q.limit(100);
  if (error) throw error;
  return data ?? [];
}

// ── AgentTerminal & TransactionDetail joined queries ────────

export async function fetchBankWithWallets(id: string): Promise<any> {
  if (useServer) return serverGet(`/banks/${id}`);
  const { data, error } = await supabase
    .from('banks')
    .select('*, wallets(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchAgentMessagesForBank(
  bankId: string,
  limit = 100,
): Promise<any[]> {
  if (useServer) {
    return serverGet('/agent-messages', { bank_id: bankId, limit: String(limit) });
  }
  const { data, error } = await supabase
    .from('agent_messages')
    .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code, name), to_bank:banks!agent_messages_to_bank_id_fkey(short_code, name)')
    .or(`to_bank_id.eq.${bankId},from_bank_id.eq.${bankId},to_bank_id.is.null`)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchPendingAgentMessages(
  bankId: string,
  limit = 10,
): Promise<any[]> {
  if (useServer) {
    return serverGet('/agent-messages', { bank_id: bankId, processed: 'false', limit: String(limit) });
  }
  const { data, error } = await supabase
    .from('agent_messages')
    .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code, name), to_bank:banks!agent_messages_to_bank_id_fkey(short_code, name)')
    .eq('to_bank_id', bankId)
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchAgentMessageProcessed(messageId: string): Promise<boolean> {
  if (useServer) {
    // TODO: add REST endpoint /data/agent-message-processed
    // Fallback to Supabase for now
  }
  const { data, error } = await supabase
    .from('agent_messages')
    .select('processed')
    .eq('id', messageId)
    .single();
  if (error) throw error;
  return data?.processed ?? false;
}

export async function fetchTransactionStatus(id: string): Promise<string | null> {
  if (useServer) {
    const tx = await serverGet<any>(`/transactions/${id}`);
    return tx?.status ?? null;
  }
  const { data, error } = await supabase
    .from('transactions')
    .select('status')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data?.status ?? null;
}

export async function fetchTransactionWithBanks(id: string): Promise<any> {
  if (useServer) return serverGet(`/transactions/${id}`);
  const { data, error } = await supabase
    .from('transactions')
    .select('*, sender_bank:banks!transactions_sender_bank_id_fkey(id, name, short_code, jurisdiction, tier, swift_bic, status, token_mint_address, token_symbol, agent_system_prompt), receiver_bank:banks!transactions_receiver_bank_id_fkey(id, name, short_code, jurisdiction, tier, swift_bic, status, token_mint_address, token_symbol, agent_system_prompt)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchAgentMessagesForTransaction(
  txId: string,
): Promise<any[]> {
  if (useServer) {
    return serverGet('/agent-messages', { transaction_id: txId });
  }
  const { data, error } = await supabase
    .from('agent_messages')
    .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code, name), to_bank:banks!agent_messages_to_bank_id_fkey(short_code, name)')
    .eq('transaction_id', txId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchCount(table: string, filter?: string): Promise<number> {
  if (useServer) {
    const p: Record<string, string> = { table };
    if (filter) p.filter = filter;
    const result = await serverGet<{ count: number }>('/count', p);
    return result.count;
  }
  // Supabase path: use head + count
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (filter) {
    const [col, val] = filter.split('=');
    if (val === 'null') {
      q = q.is(col, null);
    } else {
      q = q.eq(col, val);
    }
  }
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
