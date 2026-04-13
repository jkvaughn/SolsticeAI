// ============================================================
// db.ts — Generic database client
//
// Components import { db } from '../db' — never import supabase directly.
// Routing: production (VITE_SERVER_BASE_URL) → REST, staging → Supabase.
// ============================================================

import { supabase, serverBaseUrl } from './supabaseClient';
import { RUNTIME_IS_PRODUCTION } from './runtime-env';

const isProduction = RUNTIME_IS_PRODUCTION;
const dataBase = isProduction ? `${serverBaseUrl}/data` : null;

// ── REST helper (production path) ──────────────────────────

async function restGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${dataBase}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DB fetch ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Supabase helpers (staging path) ────────────────────────

async function sbSelect<T>(table: string, params?: Record<string, any>): Promise<T[]> {
  let query = supabase.from(table).select('*');
  if (params?.id) query = query.eq('id', params.id);
  if (params?.status) query = query.eq('status', params.status);
  if (params?.bank_id) query = query.eq('bank_id', params.bank_id);
  if (params?.transaction_id) query = query.eq('transaction_id', params.transaction_id);
  if (params?.limit) query = query.limit(params.limit);
  query = query.order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as T[];
}

async function sbSelectOne<T>(table: string, id: string): Promise<T> {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data as T;
}

async function sbCount(table: string, params?: Record<string, any>): Promise<number> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (params?.status) query = query.eq('status', params.status);
  if (params?.statuses) query = query.in('status', params.statuses);
  if (params?.resolved_by_like) query = query.like('resolved_by', params.resolved_by_like + '%');
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

// ── Dedicated count endpoints (production) ─────────────────

const DEDICATED_COUNT_ENDPOINTS: Record<string, string> = {
  transactions: '/transaction-count',
  lockup_tokens: '/lockup-token-count',
  cadenza_flags: '/cadenza-flag-count',
};

// ── Table class ────────────────────────────────────────────

class Table<T = any> {
  constructor(
    private restPath: string,
    private sbTable: string,
  ) {}

  async list(params?: Record<string, any>): Promise<T[]> {
    if (isProduction) return restGet<T[]>(this.restPath, params);
    return sbSelect<T>(this.sbTable, params);
  }

  async get(id: string): Promise<T> {
    if (isProduction) return restGet<T>(`${this.restPath}/${id}`);
    return sbSelectOne<T>(this.sbTable, id);
  }

  async count(params?: Record<string, any>): Promise<number> {
    if (isProduction) {
      const dedicated = DEDICATED_COUNT_ENDPOINTS[this.sbTable];
      if (dedicated) {
        const result = await restGet<{ count: number }>(dedicated, params);
        return result.count;
      }
      const filter = params?.status ? `status=${params.status}` : undefined;
      const result = await restGet<{ count: number }>('/count', { table: this.sbTable, filter });
      return result.count;
    }
    return sbCount(this.sbTable, params);
  }
}

// ── Exported db object ─────────────────────────────────────

export const db = {
  banks: new Table('/banks', 'banks'),
  transactions: new Table('/transactions', 'transactions'),
  agentMessages: new Table('/agent-messages', 'agent_messages'),
  agentConversations: new Table('/agent-conversations', 'agent_conversations'),
  complianceLogs: new Table('/compliance-logs', 'compliance_logs'),
  riskScores: new Table('/risk-scores', 'risk_scores'),
  cadenzaFlags: new Table('/cadenza-flags', 'cadenza_flags'),
  lockupTokens: new Table('/lockup-tokens', 'lockup_tokens'),
  heartbeatCycles: new Table('/heartbeat-cycles', 'heartbeat_cycles'),
  treasuryMandates: new Table('/treasury-mandates', 'treasury_mandates'),
  bankAgentConfig: new Table('/bank-agent-config', 'bank_agent_config'),
  networkWallets: new Table('/network-wallets', 'network_wallets'),
  networkSnapshots: new Table('/network-snapshots', 'network_snapshots'),
  simulatedWatchlist: new Table('/simulated-watchlist', 'simulated_watchlist'),
  wallets: new Table('/wallets', 'wallets'),

  // ── Aggregate queries (no table class) ───────────────────

  async settledVolume(): Promise<number> {
    if (isProduction) {
      const r = await restGet<{ total: number }>('/settled-volume');
      return r.total;
    }
    const { data } = await supabase.from('transactions').select('amount_display').eq('status', 'settled');
    return (data ?? []).reduce((s: number, t: any) => s + (Number(t.amount_display) || 0), 0);
  },

  async settledVolumeRaw(): Promise<number> {
    if (isProduction) {
      const r = await restGet<{ total: number }>('/settled-volume-raw');
      return r.total;
    }
    const { data } = await supabase.from('transactions').select('amount').eq('status', 'settled');
    return (data ?? []).reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
  },

  async resolvedEscalations(limit = 10): Promise<any[]> {
    if (isProduction) return restGet('/resolved-escalations', { limit });
    const { data } = await supabase.from('lockup_tokens')
      .select('id, transaction_id, sender_bank_id, receiver_bank_id, resolution, resolved_by, resolved_at')
      .like('resolved_by', 'operator:%')
      .order('resolved_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  },

  async transactionsInWindow(start: string, end: string): Promise<any[]> {
    if (isProduction) return restGet('/transactions-in-window', { start, end });
    const { data } = await supabase.from('transactions')
      .select('*, sender_bank:banks!transactions_sender_bank_id_fkey(short_code, name), receiver_bank:banks!transactions_receiver_bank_id_fkey(short_code, name)')
      .gte('created_at', start).lte('created_at', end)
      .order('created_at', { ascending: false });
    return data ?? [];
  },

  async agentMessagesInWindow(start: string, end: string, messageType?: string): Promise<any[]> {
    if (isProduction) return restGet('/agent-messages-in-window', { start, end, message_type: messageType });
    let q = supabase.from('agent_messages')
      .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code), to_bank:banks!agent_messages_to_bank_id_fkey(short_code)')
      .gte('created_at', start).lte('created_at', end);
    if (messageType) q = q.eq('message_type', messageType);
    const { data } = await q.order('created_at', { ascending: false });
    return data ?? [];
  },

  async agentMessagesWithBanks(limit = 50): Promise<any[]> {
    if (isProduction) return restGet('/agent-messages-with-banks', { limit });
    const { data } = await supabase.from('agent_messages')
      .select('*, from_bank:banks!agent_messages_from_bank_id_fkey(short_code), to_bank:banks!agent_messages_to_bank_id_fkey(short_code)')
      .order('created_at', { ascending: false }).limit(limit);
    return data ?? [];
  },
};

export default db;
