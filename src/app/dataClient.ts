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
  let q = supabase.from('transactions').select('*').order('created_at', { ascending: false });
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
  const { data, error } = await supabase.from('transactions').select('*').eq('id', id).single();
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
