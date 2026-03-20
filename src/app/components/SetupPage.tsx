import { useEffect, useState, useCallback, useRef, type ComponentType } from 'react';
import {
  Plus, Users, RefreshCw, ExternalLink, CheckCircle2, Loader2,
  XCircle, ChevronDown, ChevronUp, AlertTriangle, Trash2, Copy,
  Wallet, Clock, Globe, RotateCcw, Network, ArrowRight, Shield,
  FlaskConical, Building2, Landmark, Coins
} from 'lucide-react';
import { Navigate } from 'react-router';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useAuth } from '../contexts/AuthContext';
import { callServer } from '../supabaseClient';

// Module-level admin helper — used by both SetupPage and SeedBankCardUI
function adminCallServer<T = unknown>(
  route: string,
  body?: Record<string, unknown> | unknown,
  maxRetries = 3,
  email?: string | null,
) {
  return callServer<T>(route, body, maxRetries, {
    headers: email ? { 'X-Admin-Email': email } : {},
  });
}
import type { Bank, Wallet as WalletType, SetupBankRequest } from '../types';
import { truncateAddress, explorerUrl, formatTokenAmount } from '../types';
import { useBanks } from '../contexts/BanksContext';
import { useSWRCache } from '../hooks/useSWRCache';
import { PageHeader } from './PageHeader';
import { PageTransition } from './PageTransition';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';

// ── Environment detection ──
const isProductionCluster = (import.meta.env.VITE_SOLANA_CLUSTER || 'devnet') === 'mainnet-beta';
const gasToken = isProductionCluster ? 'SNT' : 'SOL';

// ── Test bank configurations (production vs staging) ──
// Production uses generic test bank names to keep the DB clean for real onboarding.
// Staging uses realistic names for demo/development purposes.

const TEST_BANKS_PROD: SetupBankRequest[] = [
  {
    name: 'Test Bank Alpha',
    short_code: 'TBA',
    swift_bic: 'TBANUS01',
    jurisdiction: 'US',
    initial_deposit_supply: 10_000_000,
    agent_system_prompt: "You are Test Bank Alpha's autonomous settlement agent on the CODA Solstice Network. As a Tier 1 test institution, you maintain strict compliance standards and prefer established counterparties. You process high-volume wholesale settlements daily. Your risk tolerance is moderate — you accept most well-documented interbank transfers but flag anything unusual. Always verify purpose codes and memos before accepting.",
  },
  {
    name: 'Test Bank Bravo',
    short_code: 'TBB',
    swift_bic: 'TBBNUS02',
    jurisdiction: 'US',
    initial_deposit_supply: 10_000_000,
    agent_system_prompt: "You are Test Bank Bravo's autonomous settlement agent on the CODA Solstice Network. As a global transaction banking test institution, you handle high-volume cross-border and domestic wholesale settlements. You are efficient and approval-oriented for known counterparties in good standing. You prioritize speed while maintaining compliance. Always confirm receipt and settlement promptly.",
  },
  {
    name: 'Test Bank Charlie',
    short_code: 'TBC',
    swift_bic: 'TBCNUS03',
    jurisdiction: 'US',
    initial_deposit_supply: 5_000_000,
    agent_system_prompt: "You are Test Bank Charlie's autonomous settlement agent on the CODA Solstice Network. As a community-sized test institution, you are thorough and conservative in your approach. You carefully review all incoming settlement requests, especially from larger institutions. You value transparency and always provide detailed reasoning for your decisions. Your compliance standards are high relative to your size.",
  },
  {
    name: 'Test Bank Delta',
    short_code: 'TBD',
    swift_bic: 'TBDNUS04',
    jurisdiction: 'US',
    initial_deposit_supply: 10_000_000,
    agent_system_prompt: "You are Test Bank Delta's autonomous settlement agent on the CODA Solstice Network. As the universal custodian test institution, you oversee cross-bank settlement custody and manage the three-token lockup flow. You ensure all custodial operations follow strict compliance and settlement finality requirements.",
  },
];

const TEST_BANKS_STAGING: SetupBankRequest[] = [
  {
    name: 'JPMorgan Chase',
    short_code: 'JPM',
    swift_bic: 'CHASUS33',
    jurisdiction: 'US',
    initial_deposit_supply: 10_000_000,
    agent_system_prompt: "You are JPMorgan Chase's autonomous settlement agent on the CODA Solstice Network. As a Tier 1 global bank, you maintain strict compliance standards and prefer established counterparties. You process high-volume wholesale settlements daily. Your risk tolerance is moderate — you accept most well-documented interbank transfers but flag anything unusual. Always verify purpose codes and memos before accepting.",
  },
  {
    name: 'Citibank',
    short_code: 'CITI',
    swift_bic: 'CITIUS33',
    jurisdiction: 'US',
    initial_deposit_supply: 10_000_000,
    agent_system_prompt: "You are Citibank's autonomous settlement agent on the CODA Solstice Network. As a global transaction banking leader, you handle high-volume cross-border and domestic wholesale settlements. You are efficient and approval-oriented for known counterparties in good standing. You prioritize speed while maintaining compliance. Always confirm receipt and settlement promptly.",
  },
  {
    name: 'First National Bank of Texas',
    short_code: 'FNBT',
    swift_bic: 'FNBTUS44',
    jurisdiction: 'US',
    initial_deposit_supply: 5_000_000,
    agent_system_prompt: "You are First National Bank of Texas's autonomous settlement agent on the CODA Solstice Network. As a community bank and IBAT member, you are thorough and conservative in your approach. You carefully review all incoming settlement requests, especially from larger institutions. You value transparency and always provide detailed reasoning for your decisions. Your compliance standards are high relative to your size.",
  },
  {
    name: 'The Bank of New York Mellon Corporation',
    short_code: 'BNY',
    swift_bic: 'IRVTUS3N',
    jurisdiction: 'US',
    initial_deposit_supply: 10_000_000,
    agent_system_prompt: "You are BNY Mellon's autonomous settlement agent on the CODA Solstice Network. As the universal custodian, you oversee cross-bank settlement custody and manage the three-token lockup flow. You ensure all custodial operations follow strict compliance and settlement finality requirements.",
  },
];

const DEMO_BANKS: SetupBankRequest[] = isProductionCluster ? TEST_BANKS_PROD : TEST_BANKS_STAGING;

const DEMO_SHORT_CODES = DEMO_BANKS.map((b) => b.short_code.toUpperCase());

const JURISDICTIONS = ['US', 'UK', 'EU', 'SG', 'JP', 'CH'];

const DEPLOYMENT_STEPS = [
  { id: 'keypair', label: isProductionCluster ? 'Generating Solana keypair (Solstice)' : 'Generating Solana keypair (Devnet)' },
  { id: 'mint', label: 'Creating SPL Token-2022 mint' },
  { id: 'ata', label: 'Creating ATA + enabling MemoTransfer' },
  { id: 'supply', label: 'Minting initial token supply' },
];

// ── Per-bank card status for the two-stage seeder ──
type SeedCardStatus = 'pending' | 'wallet_created' | 'awaiting_funding' | 'activating' | 'active' | 'error';

interface SeedBankCard {
  short_code: string;
  name: string;
  status: SeedCardStatus;
  detail?: string;
  public_key?: string;
  bank_id?: string;
  token_mint?: string;
  sol_balance?: number;
  // The full request config (needed for retries)
  config: SetupBankRequest;
}

const MIN_SOL_REQUIRED = 0.05;

// ── Infrastructure wallet types ──
interface InfraWallet {
  id: string;
  name: string;
  code: string;
  wallet_address: string;
  role?: string;
  purpose?: string;
  balance?: number;
  sol_balance: number;
  created_at: string;
  linked_bank_id?: string;
}

interface InfraWalletsData {
  custodian: InfraWallet | null;
  fees_wallet: InfraWallet | null;
}

async function fetchInfraWallets(): Promise<InfraWalletsData> {
  const res = await callServer<{ status: string; custodian: InfraWallet | null; fees_wallet: InfraWallet | null }>('/custodian-status', {});
  return { custodian: res.custodian ?? null, fees_wallet: res.fees_wallet ?? null };
}

// ── Copy helper ──
function copyToClipboard(text: string): boolean {
  // Try modern API first
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      // Silently fall through — legacy fallback already ran below
    });
  }
  // Always also try legacy fallback (works in sandboxed iframes)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

// ── Fetch SOL balance from Solana Devnet RPC directly ──
async function fetchSolBalanceRpc(pubkey: string): Promise<number | null> {
  try {
    const resp = await fetch('https://api.devnet.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [pubkey],
      }),
    });
    const json = await resp.json();
    if (json.result?.value !== undefined) {
      return json.result.value / 1_000_000_000; // lamports -> SOL
    }
    return null;
  } catch {
    return null;
  }
}

export function SetupPage() {
  const isAdmin = useIsAdmin();
  const { userEmail } = useAuth();
  const { banks, isLoading: loading, revalidate } = useBanks();

  // Bind admin email for server calls
  const adminCall = <T = unknown>(route: string, body?: Record<string, unknown> | unknown, maxRetries = 3) =>
    adminCallServer<T>(route, body, maxRetries, userEmail);
  const [showForm, setShowForm] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deploySteps, setDeploySteps] = useState<{ id: string; label: string; status: 'pending' | 'running' | 'complete' | 'error'; detail?: string }[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [seedCards, setSeedCards] = useState<SeedBankCard[]>([]);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resettingTokens, setResettingTokens] = useState(false);
  const [solBalances, setSolBalances] = useState<Record<string, number | null>>({});

  // ── Custodian & Fees Wallet state (SWR-cached) ──
  const {
    data: infraData,
    isValidating: infraValidating,
    invalidate: invalidateInfra,
  } = useSWRCache<InfraWalletsData>({
    key: 'setup-infra-wallets',
    fetcher: fetchInfraWallets,
    ttl: 3 * 60 * 1000, // 3 min
  });

  const custodian = infraData?.custodian ?? null;
  const feesWallet = infraData?.fees_wallet ?? null;
  const infraLoading = !infraData && infraValidating;

  const [infraDeploying, setInfraDeploying] = useState(false);
  const [infraError, setInfraError] = useState<string | null>(null);

  // Custodian bank code — TBD (Test Bank Delta) in production, BNY in staging
  const custodianCode = isProductionCluster ? 'TBD' : 'BNY';
  const custodianLabel = isProductionCluster ? 'Test Bank Delta (TBD)' : 'BNY Mellon';

  async function setupCustodian() {
    setInfraDeploying(true);
    setInfraError(null);
    try {
      const res = await adminCall<{ status: string; custodian: InfraWallet; fees_wallet: InfraWallet }>('/setup-custodian', { custodian_code: custodianCode });
      console.log('[setup-custodian] ✓ Created:', res.status);
      // Invalidate SWR cache so it picks up the new wallets
      invalidateInfra();
    } catch (err: any) {
      console.error('[setup-custodian] Error:', err);
      setInfraError(err.message || 'Failed to setup custodian');
    } finally {
      setInfraDeploying(false);
    }
  }

  function refreshInfraBalances() {
    invalidateInfra();
  }

  // Network mode derived from build-time env var (no toggle, no server call)
  const networkMode = isProductionCluster ? 'production' : 'devnet';

  // ── Fetch live SOL balances from Solana Devnet RPC ──
  const fetchSolBalances = useCallback(async (bankList: { solana_wallet_pubkey?: string | null }[]) => {
    const pubkeys = bankList
      .map((b) => b.solana_wallet_pubkey)
      .filter((pk): pk is string => !!pk);
    if (pubkeys.length === 0) return;

    const results: Record<string, number | null> = {};
    await Promise.all(
      pubkeys.map(async (pk) => {
        results[pk] = await fetchSolBalanceRpc(pk);
      })
    );
    console.log('[fetchSolBalances]', Object.entries(results).map(([k, v]) => `${k.slice(0, 8)}…=${v?.toFixed(4) ?? '?'}`).join(', '));
    setSolBalances(results);
  }, []);

  const seedingRef = useRef(false);
  const seedCardsRef = useRef<SeedBankCard[]>([]);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formJurisdiction, setFormJurisdiction] = useState('US');
  const [formSupply, setFormSupply] = useState(10_000_000);

  // Fetch SOL balances whenever banks change
  useEffect(() => {
    if (banks.length > 0) {
      fetchSolBalances(banks);
    }
  }, [banks, fetchSolBalances]);

  // One-shot SWIFT/BIC backfill on mount
  useEffect(() => {
    adminCall<{ message: string; updated: { short_code: string; swift_bic: string }[] }>('/backfill-swift', {})
      .then((res) => {
        if (res.updated?.length > 0) {
          console.log(`[backfill-swift] Backfilled ${res.updated.length} bank(s):`, res.updated.map((u: any) => `${u.short_code}→${u.swift_bic}`).join(', '));
          revalidate();
        } else {
          console.log('[backfill-swift] All banks already have SWIFT/BIC codes');
        }
      })
      .catch((err: any) => console.warn('[backfill-swift] Backfill failed (non-blocking):', err));
  }, [revalidate]);

  // On mount, restore seed cards for non-active banks (from DB state)
  // Restore seed cards for ALL non-active banks (demo AND manually-added).
  // This ensures manually-added banks like HSBC keep their onboarding
  // card visible across page navigations until fully activated.
  useEffect(() => {
    if (banks.length > 0 && seedCards.length === 0 && !seedingDemo) {
      const pendingBanks = banks.filter(
        (b) => b.status !== 'active' && b.status !== 'suspended'
      );
      if (pendingBanks.length > 0) {
        const restored: SeedBankCard[] = pendingBanks.map((b) => {
          const config = DEMO_BANKS.find((d) => d.short_code.toUpperCase() === b.short_code?.toUpperCase());
          return {
            short_code: b.short_code,
            name: b.name,
            status: 'awaiting_funding' as SeedCardStatus,
            detail: 'Wallet created — needs funding',
            public_key: b.solana_wallet_pubkey || undefined,
            bank_id: b.id,
            config: config || { name: b.name, short_code: b.short_code, jurisdiction: b.jurisdiction || 'US', initial_deposit_supply: b.initial_deposit_supply || 10_000_000 },
          };
        });
        setSeedCards(restored);
        seedCardsRef.current = restored;
      }
    }
  }, [banks, seedCards.length, seedingDemo]);

  // Determine which demo banks are fully onboarded
  const onboardedDemoCodes = banks
    .filter((b) => DEMO_SHORT_CODES.includes(b.short_code?.toUpperCase()) && b.status === 'active' && b.token_mint_address)
    .map((b) => b.short_code.toUpperCase());

  const seedCodes = DEMO_BANKS.map((b) => b.short_code.toUpperCase());
  const allSeedBanksOnboarded = seedCodes.every((code) => onboardedDemoCodes.includes(code));

  // ── Seed flow: PASS 1 ONLY (wallet creation — no auto-activation) ──
  async function seedDemoNetwork() {
    setSeedingDemo(true);
    seedingRef.current = true;
    setSeedError(null);

    // Initialize cards
    const initialCards: SeedBankCard[] = DEMO_BANKS.map((b) => ({
      short_code: b.short_code,
      name: b.name,
      status: 'pending' as SeedCardStatus,
      config: b,
    }));
    setSeedCards(initialCards);
    seedCardsRef.current = initialCards;

    try {
      // ── PASS 1: Wallet creation (near-instant, no network ops) ──
      console.log(`[seed] ═══ PASS 1: WALLET CREATION — ${DEMO_BANKS.length} banks ═══`);
      for (let i = 0; i < DEMO_BANKS.length; i++) {
        const bank = DEMO_BANKS[i];
        const code = bank.short_code.toUpperCase();

        console.log(`[seed] [${i + 1}/${DEMO_BANKS.length}] Starting wallet stage for ${code} (${bank.name})`);
        updateCard(bank.short_code, { status: 'pending', detail: 'Creating wallet...' });

        try {
          const payload = { ...bank, stage: 'wallet' };
          console.log(`[seed] ${code} → adminCall /setup-bank payload:`, JSON.stringify(payload));

          const result = await adminCall<{
            stage: string;
            public_key?: string;
            bank_id?: string;
            step?: string;
            reused?: boolean;
            error?: string;
            pg_code?: string;
            pg_details?: string;
          }>('/setup-bank', payload, 0);

          console.log(`[seed] ${code} ← wallet result: stage=${result.stage}, bank_id=${result.bank_id}, public_key=${result.public_key}, reused=${result.reused}`);

          if (result.stage === 'already_onboarded' || result.step === 'already_onboarded') {
            updateCard(bank.short_code, {
              status: 'active',
              detail: 'Already onboarded',
              public_key: result.public_key,
              bank_id: result.bank_id,
            });
          } else if (result.stage === 'wallet_created') {
            updateCard(bank.short_code, {
              status: 'awaiting_funding',
              detail: result.reused ? 'Wallet reused — needs funding' : 'Wallet created — needs funding',
              public_key: result.public_key,
              bank_id: result.bank_id,
            });
          } else {
            console.warn(`[seed] ${code} wallet stage returned unexpected stage: ${result.stage}`, result);
            updateCard(bank.short_code, { status: 'error', detail: `Unexpected stage: ${result.stage}` });
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          updateCard(bank.short_code, { status: 'error', detail: errMsg });
          console.error(`[seed] ✗ Wallet stage failed for ${code}:`, errMsg);
        }
      }

      // No PASS 2 — activation is now user-triggered per bank after manual SOL funding
      console.log(`[seed] ═══ WALLET CREATION COMPLETE — user must fund wallets via faucet, then activate individually ═══`);
      await revalidate();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown seeding error';
      console.error('[seed] ✗ Top-level seeding error:', errorMessage);
      setSeedError(errorMessage);
    } finally {
      seedingRef.current = false;
      setSeedingDemo(false);
    }
  }

  // Helper to update a single card
  function updateCard(short_code: string, updates: Partial<SeedBankCard>) {
    setSeedCards((prev) =>
      prev.map((c) =>
        c.short_code === short_code ? { ...c, ...updates } : c
      )
    );
    // Also update the ref synchronously so getCurrentCard always has latest state
    seedCardsRef.current = seedCardsRef.current.map((c) =>
      c.short_code === short_code ? { ...c, ...updates } : c
    );
  }

  // ── Per-bank activate action ─────────────────────────────
  async function activateBank(card: SeedBankCard) {
    if (!card.bank_id) return;
    updateCard(card.short_code, { status: 'activating', detail: 'Deploying tokens...' });

    try {
      const result = await adminCall<{
        stage: string;
        public_key?: string;
        bank_id?: string;
        token_mint?: string;
        sol_balance?: number;
        bank?: Bank;
        wallet?: WalletType;
        error?: string;
      }>('/setup-bank', { ...card.config, stage: 'activate', bank_id: card.bank_id }, 0);

      if (result.stage === 'activated') {
        updateCard(card.short_code, {
          status: 'active',
          detail: 'Activated',
          token_mint: result.token_mint,
          sol_balance: result.sol_balance,
        });
      } else if (result.stage === 'already_onboarded') {
        updateCard(card.short_code, {
          status: 'active',
          detail: 'Already onboarded',
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Activation failed';
      // Check if it's an insufficient SOL error (server returns 400)
      if (errMsg.includes('insufficient_sol') || errMsg.includes('Insufficient SOL')) {
        updateCard(card.short_code, {
          status: 'awaiting_funding',
          detail: 'Still needs funding',
        });
      } else {
        updateCard(card.short_code, { status: 'error', detail: errMsg });
      }
    }

    await revalidate();
  }

  // ── Manual deploy: Stage 1 only (wallet creation). ──
  // After wallet creation, adds a seed card in awaiting_funding state.
  // User must fund via faucet and click Activate (same flow as demo banks).
  async function deployBank(request: SetupBankRequest) {
    setDeploying(true);
    setDeployError(null);
    setDeploySteps([
      { id: 'keypair', label: 'Generating Solana keypair (Devnet)', status: 'running' },
    ]);

    try {
      const result = await adminCall<{
        stage: string;
        public_key?: string;
        bank_id?: string;
        step?: string;
        reused?: boolean;
        bank?: Bank;
        wallet?: WalletType;
      }>('/setup-bank', { ...request, stage: 'wallet' }, 0);

      console.log(`[deployBank] Result: stage=${result.stage}, bank_id=${result.bank_id}, public_key=${result.public_key}`);

      if (result.stage === 'already_onboarded' || result.step === 'already_onboarded') {
        setDeploySteps([{ id: 'keypair', label: 'Generating Solana keypair (Devnet)', status: 'complete' }]);
        setDeployError(`${request.short_code} is already onboarded.`);
      } else if (result.stage === 'wallet_created') {
        setDeploySteps([{ id: 'keypair', label: 'Generating Solana keypair (Devnet)', status: 'complete' }]);

        // Add a seed card for the new bank so user can fund & activate
        const newCard: SeedBankCard = {
          short_code: request.short_code.toUpperCase(),
          name: request.name,
          status: 'awaiting_funding',
          detail: 'Wallet created — needs funding',
          public_key: result.public_key,
          bank_id: result.bank_id,
          config: request,
        };
        setSeedCards((prev) => [...prev, newCard]);
        seedCardsRef.current = [...seedCardsRef.current, newCard];
      }

      await revalidate();
      setShowForm(false);
      resetForm();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown deployment error';
      console.error('Bank deployment error:', errorMessage);
      setDeployError(errorMessage);
      setDeploySteps([
        { id: 'keypair', label: 'Generating Solana keypair (Devnet)', status: 'error', detail: errorMessage },
      ]);
    } finally {
      setDeploying(false);
    }
  }

  async function resetNetwork() {
    console.log('[reset] Starting network reset...');
    setResetting(true);
    try {
      await adminCall('/reset-network', {});
      console.log('[reset] Reset complete');
      setSeedCards([]);
      seedCardsRef.current = [];
      setSeedError(null);
      setDeployError(null);
      await revalidate();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Reset failed';
      console.error('Reset error:', errorMessage);
      setDeployError(errorMessage);
    } finally {
      setResetting(false);
    }
  }

  async function resetTokens() {
    console.log('[reset] Starting token reset...');
    setResettingTokens(true);
    try {
      const result = await adminCall<{
        status: string;
        banks_preserved: number;
        tables: Record<string, { success: boolean; error?: string; detail?: string }>;
      }>('/reset-tokens', {});
      console.log('[reset] Token reset response:', JSON.stringify(result));

      // Check if any step failed (especially the critical banks step)
      const failedSteps = Object.entries(result.tables || {})
        .filter(([, v]) => !v.success)
        .map(([table, v]) => `${table}: ${v.error}`);

      if (failedSteps.length > 0) {
        console.error('[reset] Partial failures:', failedSteps);
        setDeployError(`Token reset partial failure: ${failedSteps.join('; ')}`);
      } else {
        setDeployError(null);
      }

      setSeedCards([]);
      seedCardsRef.current = [];
      await revalidate();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Token reset failed';
      console.error('Token reset error:', errorMessage);
      setDeployError(errorMessage);
    } finally {
      setResettingTokens(false);
    }
  }

  function resetForm() {
    setFormName('');
    setFormCode('');
    setFormJurisdiction('US');
    setFormSupply(10_000_000);
    setDeploySteps([]);
    setDeployError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    deployBank({
      name: formName,
      short_code: formCode.toUpperCase(),
      jurisdiction: formJurisdiction,
      initial_deposit_supply: formSupply,
    });
  }

  const defaultWallet = (bank: Bank & { wallets?: WalletType[] }) =>
    bank.wallets?.find((w) => w.is_default) || bank.wallets?.[0];

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Network}
        title="Solstice Network"
        subtitle={`Manage member banks and tokenized deposit wallets on ${isProductionCluster ? 'Solstice Network' : 'Solana Devnet'}`}
      >
        <div className="flex gap-2">
          <button
            onClick={revalidate}
            className="flex items-center gap-1.5 px-3 py-1.5 dashboard-button text-xs text-foreground"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setDeployError(null); }}
            disabled={deploying}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-200 dark:hover:bg-neutral-300 dark:text-neutral-900 disabled:opacity-50 rounded-xl text-xs text-white transition-colors liquid-button"
          >
            <Plus className="w-3 h-3" />
            Add Bank
          </button>
        </div>
      </PageHeader>

      {/* Global error display (visible after reset operations) */}
      {deployError && !showForm && (
        <div className="mb-4 p-3 rounded-lg border border-red-800/50 bg-red-950/20">
          <div className="flex items-center gap-2 text-xs font-mono text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{deployError}</span>
            <button
              onClick={() => setDeployError(null)}
              className="text-red-600 hover:text-red-400 text-[10px] shrink-0"
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Network Environment Card ── */}
      <div className="dashboard-card overflow-hidden">
        <div className="px-4 py-3 border-b border-coda-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-coda-text-muted" />
            <h2 className="text-sm font-medium dashboard-text">Network Environment</h2>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium ${
            networkMode === 'devnet'
              ? 'bg-coda-brand/15 text-coda-brand border border-coda-brand/20'
              : 'bg-black/[0.06] dark:bg-white/[0.08] text-coda-text-secondary border border-black/[0.08] dark:border-white/[0.10]'
          }`}>
            {networkMode === 'devnet' ? (
              <><FlaskConical className="w-3 h-3" />Devnet Mode</>
            ) : (
              <><Building2 className="w-3 h-3" />Solstice Network</>
            )}
          </span>
        </div>
        <div className="px-4 py-3">
          {networkMode === 'devnet' ? (
            <>
              <p className="text-xs text-coda-text-secondary leading-relaxed">
                AI agents are aware this is a <span className="text-coda-brand font-medium">controlled demo environment</span> on
                Solana Devnet. Token-2022 settlements are treated as the intended infrastructure &mdash;
                Devnet will <span className="text-coda-text font-medium">not</span> be flagged as an operational risk in risk assessments.
              </p>
              <p className="text-[11px] text-coda-text-muted mt-1.5">
                Agents evaluate transactions purely on financial merit: counterparty reputation, jurisdiction, amount, and purpose codes.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-coda-text-secondary leading-relaxed">
                AI agents operate in <span className="text-coda-text font-medium">production assessment mode</span> on
                the <span className="text-coda-brand font-medium">Solstice Network</span>.
                Token-2022 settlements execute on the production SPE with full institutional-grade infrastructure.
              </p>
              <p className="text-[11px] text-coda-text-muted mt-1.5">
                Agents evaluate transactions on financial merit with production-grade risk assessment.
              </p>
            </>
          )}
        </div>
      </div>

      <PageTransition className="space-y-4">
      {/* Onboard Demo Banks Prompt / Awaiting Funding Cards */}
      {!loading && (!allSeedBanksOnboarded || seedCards.some((c) => c.status !== 'active')) && !showForm && (
        <div className="dashboard-card p-6 mb-6">
          <div className="text-center mb-4">
            <Users className="w-8 h-8 text-coda-text-secondary mx-auto mb-3" />
            <h3 className="font-mono text-sm font-bold dashboard-text mb-1">
              {banks.length === 0 && seedCards.length === 0
                ? 'Onboard demo consortium members'
                : seedCards.filter((c) => c.status !== 'active').length > 0
                  ? `${seedCards.filter((c) => c.status !== 'active').length} bank${seedCards.filter((c) => c.status !== 'active').length > 1 ? 's' : ''} pending activation`
                  : `${seedCodes.filter((c) => !onboardedDemoCodes.includes(c)).length} demo bank${seedCodes.filter((c) => !onboardedDemoCodes.includes(c)).length > 1 ? 's' : ''} remaining`}
            </h3>
            <p className="text-xs dashboard-text-muted font-mono max-w-lg mx-auto">
              {seedCards.some((c) => c.status === 'awaiting_funding')
                ? isProductionCluster
                  ? 'Wallets created! Fund each wallet via the Solstice CLI, then click Activate.'
                  : 'Wallets created! Fund each wallet via the Solana Faucet, then click Activate.'
                : isProductionCluster
                  ? 'Step 1: Generate wallets. Step 2: Fund via Solstice CLI. Step 3: Activate to deploy tokens.'
                  : 'Step 1: Generate wallets instantly. Step 2: Fund via Solana Faucet. Step 3: Activate to deploy tokens.'}
              {onboardedDemoCodes.length > 0 && (
                <> Already active: <span className="text-coda-text font-medium">{onboardedDemoCodes.join(', ')}</span>.</>
              )}
            </p>
          </div>

          {/* Show "Onboard Demo Banks" button only if no seed cards are showing yet */}
          {seedCards.length === 0 && (
            <div className="text-center mb-4">
              <button
                onClick={seedDemoNetwork}
                disabled={seedingDemo}
                className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-200 dark:hover:bg-neutral-300 dark:text-neutral-900 disabled:opacity-50 text-white text-sm font-mono rounded transition-colors"
              >
                {seedingDemo ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating wallets...
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4" />
                    Onboard Demo Banks
                  </>
                )}
              </button>
            </div>
          )}

          {/* Per-bank cards */}
          {seedCards.length > 0 && (
            <div className="max-w-2xl mx-auto space-y-3 mt-4">
              {seedCards.map((card) => (
                <SeedBankCardUI
                  key={card.short_code}
                  card={card}
                  onActivate={() => activateBank(card)}
                  adminEmail={userEmail}
                />
              ))}
            </div>
          )}

          {seedError && (
            <div className="mt-4 p-3 rounded-xl border border-red-200/60 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30 text-left max-w-md mx-auto">
              <div className="flex items-center gap-2 text-xs font-mono text-red-500 dark:text-red-400">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                {seedError}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Bank Form */}
      {showForm && (
        <div className="dashboard-card p-5 mb-6">
          <h2 className="text-sm font-mono font-bold dashboard-text mb-4">Onboard New Bank</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-coda-text-secondary mb-1">Bank Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. JPMorgan Chase"
                  required
                  className="w-full px-3 py-2 bg-coda-input-bg border border-coda-input-border rounded text-sm font-mono text-coda-text placeholder:text-coda-text-muted focus:border-coda-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-coda-text-secondary mb-1">Short Code (3-4 chars)</label>
                <input
                  type="text"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="e.g. JPM"
                  required
                  maxLength={4}
                  className="w-full px-3 py-2 bg-coda-input-bg border border-coda-input-border rounded text-sm font-mono text-coda-text placeholder:text-coda-text-muted focus:border-coda-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-coda-text-secondary mb-1">Jurisdiction</label>
                <select
                  value={formJurisdiction}
                  onChange={(e) => setFormJurisdiction(e.target.value)}
                  className="w-full px-3 py-2 bg-coda-input-bg border border-coda-input-border rounded text-sm font-mono text-coda-text focus:border-coda-brand focus:outline-none"
                >
                  {JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono text-coda-text-secondary mb-1">Initial Token Supply</label>
                <input
                  type="number"
                  value={formSupply}
                  onChange={(e) => setFormSupply(Number(e.target.value))}
                  min={1}
                  required
                  className="w-full px-3 py-2 bg-coda-input-bg border border-coda-input-border rounded text-sm font-mono text-coda-text focus:border-coda-brand focus:outline-none"
                />
              </div>
            </div>

            {/* Deployment Progress */}
            {deploying && (
              <div className="space-y-2 p-3 bg-black/[0.03] dark:bg-white/[0.03] rounded-xl border border-coda-border-subtle">
                <p className="text-xs font-mono text-coda-text-secondary mb-2">Deployment Progress</p>
                {deploySteps.map((step) => (
                  <div key={step.id} className="flex items-center gap-2 text-xs font-mono">
                    {step.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-coda-text-faint/30" />}
                    {step.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-coda-brand animate-spin" />}
                    {step.status === 'complete' && <CheckCircle2 className="w-3.5 h-3.5 text-coda-brand" />}
                    {step.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />}
                    <span className={
                      step.status === 'complete' ? 'text-coda-brand' :
                      step.status === 'running' ? 'text-coda-text' :
                      step.status === 'error' ? 'text-red-500 dark:text-red-400' :
                      'text-coda-text-muted/40'
                    }>
                      {step.label}
                    </span>
                    {step.detail && <span className="text-red-500/60 dark:text-red-400/60 ml-2">({step.detail})</span>}
                  </div>
                ))}
              </div>
            )}

            {deployError && !deploying && (
              <div className="p-3 rounded-xl border border-red-200/60 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30">
                <div className="flex items-center gap-2 text-xs font-mono text-red-500 dark:text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {deployError}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={deploying || !formName || !formCode}
                className="flex items-center gap-1.5 px-4 py-2 bg-coda-brand hover:bg-coda-brand-dim disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-mono text-white transition-colors"
              >
                {deploying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Onboarding...
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" />
                    Onboard Bank
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                disabled={deploying}
                className="px-4 py-2 border border-coda-border rounded text-xs font-mono text-coda-text-secondary hover:text-coda-text hover:border-coda-text-muted disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Active Banks Table */}
      <div className="dashboard-card overflow-hidden">
        <div className="px-4 py-3 border-b border-coda-border/30">
          <h2 className="text-sm font-medium dashboard-text">Member Banks</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-5 h-5 text-coda-text-muted animate-spin mx-auto" />
          </div>
        ) : banks.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-coda-text-muted">
            No banks onboarded yet. Use the form above or onboard the demo consortium.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-mono text-coda-text-muted border-b border-coda-border/30">
                  <th className="px-4 py-2 font-medium">Bank</th>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">SWIFT/BIC</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Jurisdiction</th>
                  <th className="px-4 py-2 font-medium">Wallet</th>
                  <th className="px-4 py-2 font-medium">{gasToken}</th>
                  <th className="px-4 py-2 font-medium">Token Mint</th>
                  <th className="px-4 py-2 font-medium">Balance</th>
                  <th className="px-4 py-2 font-medium">Token</th>
                </tr>
              </thead>
              <tbody>
                {banks.map((bank) => {
                  const wallet = defaultWallet(bank);
                  const solBal = bank.solana_wallet_pubkey ? solBalances[bank.solana_wallet_pubkey] : undefined;
                  return (
                    <BankRow key={bank.id} bank={bank} wallet={wallet} solBalance={solBal} />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Network Infrastructure: Custodian & Fees Wallet ── */}
      <div className="dashboard-card overflow-hidden">
        <div className="px-4 py-3 border-b border-coda-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark className="w-3.5 h-3.5 text-coda-text-muted" />
            <h2 className="text-sm font-medium dashboard-text">Network Infrastructure</h2>
          </div>
          {custodian && (
            <button
              onClick={refreshInfraBalances}
              className="flex items-center gap-1 px-2 py-1 dashboard-button text-[10px] text-coda-text-muted hover:text-coda-text"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Refresh
            </button>
          )}
        </div>
        <div className="px-4 py-4">
          {infraLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 text-coda-text-muted animate-spin" />
            </div>
          ) : !custodian && !feesWallet ? (
            /* Not yet created — show setup prompt */
            <div className="text-center py-4">
              <div className="flex items-center justify-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Landmark className="w-5 h-5 text-amber-500" />
                </div>
                <div className="w-px h-6 bg-coda-border/20" />
                <div className="w-10 h-10 rounded-xl bg-coda-brand/10 border border-coda-brand/20 flex items-center justify-center">
                  <Coins className="w-5 h-5 text-coda-brand" />
                </div>
              </div>
              <h3 className="font-mono text-sm font-bold dashboard-text mb-1">
                Setup Custodian & Fees Wallet
              </h3>
              <p className="text-xs text-coda-text-muted font-mono max-w-md mx-auto mb-4">
                Links {custodianLabel} (universal custodian) to its existing bank wallet and creates a Solstice Network Fees wallet on {isProductionCluster ? 'Solstice Network' : 'Solana Devnet'}.
                Required for the three-token lockup flow (yield-bearing + T-bill backed settlement).
              </p>
              <button
                onClick={setupCustodian}
                disabled={infraDeploying}
                className="inline-flex items-center gap-2 px-4 py-2 bg-coda-brand hover:bg-coda-brand-dim disabled:opacity-50 text-white text-sm font-mono rounded-xl transition-colors liquid-button"
              >
                {infraDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Linking & creating...
                  </>
                ) : (
                  <>
                    <Landmark className="w-4 h-4" />
                    Setup Custodian & Fees Wallet
                  </>
                )}
              </button>
              {infraError && (
                <div className="mt-3 p-2.5 rounded-lg border border-red-800/50 bg-red-950/20 max-w-md mx-auto">
                  <div className="flex items-center gap-2 text-xs font-mono text-red-400">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1">{infraError}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Created — show wallet details */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* BNY Custodian Card */}
              {custodian && (
                <InfraWalletCard
                  icon={Landmark}
                  iconColor="text-amber-500"
                  iconBg="bg-amber-500/10 border-amber-500/20"
                  label="Universal Custodian"
                  name={custodian.name}
                  code={custodian.code}
                  role={custodian.role || 'custodian'}
                  walletAddress={custodian.wallet_address}
                  solBalance={custodian.sol_balance}
                  createdAt={custodian.created_at}
                  linkedBank={!!custodian.linked_bank_id}
                />
              )}
              {/* Solstice Fees Wallet Card */}
              {feesWallet && (
                <InfraWalletCard
                  icon={Coins}
                  iconColor="text-coda-brand"
                  iconBg="bg-coda-brand/10 border-coda-brand/20"
                  label="Yield Collection"
                  name={feesWallet.name}
                  code={feesWallet.code}
                  role={feesWallet.purpose || 'yield_collection'}
                  walletAddress={feesWallet.wallet_address}
                  solBalance={feesWallet.sol_balance}
                  createdAt={feesWallet.created_at}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Network Fee Protocol (mandatory, enforced) ── */}
      <NetworkFeeProtocolCard />

      {/* Reset Actions */}
      {!loading && banks.length > 0 && (
        <div className="mt-8 pt-6 border-t border-coda-border/20 space-y-3">
          {/* Soft Reset: Reset Tokens */}
          <div className="dashboard-card-subtle p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-amber-500 dark:text-amber-400">Reset Tokens</p>
              <p className="text-[11px] text-coda-text-muted mt-0.5">
                Clear transactions and rebuild token mints. Preserves bank keypairs and {gasToken} balances.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={resettingTokens || resetting || seedingDemo || deploying}
                  className="dashboard-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {resettingTokens ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Resetting tokens...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3 h-3" />
                      Reset Tokens
                    </>
                  )}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="dashboard-card-elevated !rounded-[28px] border-0">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-coda-text text-sm font-medium">Reset Token Infrastructure</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="text-coda-text-secondary text-xs leading-relaxed space-y-2">
                      <p>
                        This soft reset clears all transactions, messages, compliance logs, and risk
                        scores, then resets banks to "onboarding" status so you can re-activate
                        with fresh Token-2022 mints.
                      </p>
                      <p className="text-coda-brand">
                        Preserved: Bank keypairs, {gasToken} balances, bank names/codes.
                      </p>
                      <p className="text-coda-text-muted">
                        After reset, fund wallets via {isProductionCluster ? 'the Solstice CLI' : 'the Solana Faucet'} if needed, then click
                        "Activate" on each bank card to re-deploy tokens.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="dashboard-button text-coda-text-secondary text-xs hover:text-coda-text">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={resetTokens}
                    className="squircle-sm bg-amber-600 text-white text-xs hover:bg-amber-500 border-0"
                  >
                    Reset Tokens
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Nuclear Reset: Reset Network */}
          <div className="dashboard-card-subtle p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-red-500 dark:text-red-400">Reset Network</p>
              <p className="text-[11px] text-coda-text-muted mt-0.5">
                Delete everything including bank keypairs. Requires new wallet generation and {gasToken} funding.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  disabled={resetting || resettingTokens || seedingDemo || deploying}
                  className="dashboard-button flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3 h-3" />
                      Reset Network
                    </>
                  )}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="dashboard-card-elevated !rounded-[28px] border-0">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-coda-text text-sm font-medium">Reset Solstice Network</AlertDialogTitle>
                  <AlertDialogDescription className="text-coda-text-secondary text-xs leading-relaxed">
                    This will delete all banks, wallets, transactions, messages, and conversation
                    history from all 7 tables. On-chain assets (tokens, mints) will remain
                    on {isProductionCluster ? 'Solstice Network' : 'Devnet'} but will no longer be tracked. New wallet generation and {isProductionCluster ? 'SNT' : 'SOL'} funding
                    via {isProductionCluster ? 'the Solstice CLI' : 'the Solana Faucet'} will be required. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="dashboard-button text-coda-text-secondary text-xs hover:text-coda-text">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={resetNetwork}
                    className="squircle-sm bg-red-600 text-white text-xs hover:bg-red-500 border-0"
                  >
                    Reset Everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
      </PageTransition>
    </div>
  );
}

// ── Seed Bank Card Component ───────────────────────────────
function SeedBankCardUI({ card, onActivate, adminEmail }: {
  card: SeedBankCard;
  onActivate: () => void;
  adminEmail?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [localSolBalance, setLocalSolBalance] = useState<number | null>(card.sol_balance ?? null);
  const [activating, setActivating] = useState(false);
  const [faucetOpened, setFaucetOpened] = useState(false);
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isFunded = localSolBalance !== null && localSolBalance >= MIN_SOL_REQUIRED;

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Stop polling if card transitions to active
  useEffect(() => {
    if (card.status === 'active' && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, [card.status]);

  function handleCopy() {
    if (card.public_key) {
      copyToClipboard(card.public_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleCheckBalance() {
    if (!card.public_key) return;
    setCheckingBalance(true);
    const bal = await fetchSolBalanceRpc(card.public_key);
    setLocalSolBalance(bal);
    setCheckingBalance(false);
  }

  function handleOpenFaucet() {
    window.open(import.meta.env.VITE_SOLANA_FAUCET_URL || 'https://faucet.solana.com', '_blank');
    setFaucetOpened(true);

    // Start polling every 10 seconds
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (card.public_key) {
      pollIntervalRef.current = setInterval(async () => {
        const bal = await fetchSolBalanceRpc(card.public_key!);
        if (bal !== null) {
          setLocalSolBalance(bal);
          if (bal >= MIN_SOL_REQUIRED && pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      }, 10_000);
    }
  }

  async function handleFundWallet() {
    if (!card.public_key) return;
    setFunding(true);
    setFundError(null);
    try {
      const res = await adminCallServer<{ status: string; balance_sol: number; tx_signature: string }>('/faucet', {
        wallet_address: card.public_key,
        amount: 100,
      }, 3, adminEmail);
      console.log(`[faucet] ✓ Funded ${card.short_code}: ${res.balance_sol.toFixed(4)} ${gasToken}, tx: ${res.tx_signature}`);
      setLocalSolBalance(res.balance_sol);
    } catch (err: any) {
      console.error(`[faucet] ✗ Error funding ${card.short_code}:`, err);
      setFundError(err.message || 'Faucet request failed');
    } finally {
      setFunding(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    await onActivate();
    setActivating(false);
  }

  // All cards use neutral glass bg/border — color is ONLY in the icon + status label.
  const NEUTRAL_CARD_BG = 'border-coda-border-subtle bg-black/[0.02] dark:bg-white/[0.03]';

  const statusConfig: Record<SeedCardStatus, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
    pending: {
      icon: <Clock className="w-4 h-4 text-coda-text-muted" />,
      color: 'text-coda-text-muted',
      bg: NEUTRAL_CARD_BG,
      label: 'Queued',
    },
    wallet_created: {
      icon: <Wallet className="w-4 h-4 text-blue-500 dark:text-blue-400" />,
      color: 'text-blue-500 dark:text-blue-400',
      bg: NEUTRAL_CARD_BG,
      label: 'Wallet Ready',
    },
    awaiting_funding: {
      icon: <Wallet className="w-4 h-4 text-amber-500 dark:text-amber-400" />,
      color: 'text-amber-500 dark:text-amber-400',
      bg: NEUTRAL_CARD_BG,
      label: isFunded ? 'Funded' : `Awaiting ${gasToken}`,
    },
    activating: {
      icon: <Loader2 className="w-4 h-4 text-coda-brand animate-spin" />,
      color: 'text-coda-brand',
      bg: NEUTRAL_CARD_BG,
      label: 'Deploying tokens...',
    },
    active: {
      icon: <CheckCircle2 className="w-4 h-4 text-coda-brand" />,
      color: 'text-coda-brand',
      bg: NEUTRAL_CARD_BG,
      label: 'Active',
    },
    error: {
      icon: <XCircle className="w-4 h-4 text-red-500 dark:text-red-400" />,
      color: 'text-red-500 dark:text-red-400',
      bg: NEUTRAL_CARD_BG,
      label: 'Error',
    },
  };

  const cfg = statusConfig[card.status];

  return (
    <div className={`rounded-2xl border p-4 backdrop-blur-sm ${cfg.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          {cfg.icon}
          <div>
            <span className="font-mono text-sm font-bold text-coda-text">{card.name}</span>
            <span className="ml-2 px-1.5 py-0.5 bg-coda-surface-hover rounded text-[11px] font-mono text-coda-text-secondary">
              {card.short_code}
            </span>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-mono ${isFunded && card.status === 'awaiting_funding' ? 'text-coda-brand' : cfg.color}`}>
          {card.status === 'awaiting_funding' && !isFunded && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
          )}
          {isFunded && card.status === 'awaiting_funding' ? 'Funded \u2014 Ready to activate' : cfg.label}
        </span>
      </div>

      {/* Wallet address (shown for wallet_created, awaiting_funding, active) */}
      {card.public_key && card.status !== 'pending' && (
        <div className="mt-2 flex items-center gap-2 text-xs font-mono">
          <span className="text-coda-text-muted">Wallet:</span>
          {card.status === 'awaiting_funding' ? (
            <span className="text-coda-text break-all text-[11px]">{card.public_key}</span>
          ) : (
            <a
              href={explorerUrl(card.public_key, 'address')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1"
            >
              {truncateAddress(card.public_key, 6)}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <button
            onClick={handleCopy}
            className="text-coda-text-muted hover:text-coda-text-secondary transition-colors"
            title="Copy address"
          >
            {copied ? <CheckCircle2 className="w-3 h-3 text-coda-brand" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Token mint (shown for active) */}
      {card.status === 'active' && card.token_mint && (
        <div className="mt-1 flex items-center gap-2 text-xs font-mono">
          <span className="text-coda-text-muted">Mint:</span>
          <a
            href={explorerUrl(card.token_mint, 'address')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1"
          >
            {truncateAddress(card.token_mint, 6)}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      )}

      {/* Detail line for non-funding states */}
      {card.detail && card.status !== 'awaiting_funding' && card.status !== 'error' && (
        <div className="mt-1.5 text-[11px] font-mono text-coda-text-muted">
          {card.detail}
        </div>
      )}

      {/* ── Awaiting Funding: Manual funding flow ── */}
      {card.status === 'awaiting_funding' && (
        <div className="mt-3 space-y-3">
          {/* Gas token balance display */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-coda-text-muted">{gasToken} Balance:</span>
            {localSolBalance !== null ? (
              <span className={isFunded ? 'text-coda-brand' : 'text-red-500 dark:text-red-400'}>
                {localSolBalance.toFixed(4)} {gasToken} {isFunded ? '\u2713' : '\u2717'}
              </span>
            ) : (
              <span className="text-coda-text-muted">Unknown — click Check Balance</span>
            )}
            {!isFunded && (
              <span className="text-coda-text-muted text-[10px]">
                (min: {MIN_SOL_REQUIRED} {gasToken})
              </span>
            )}
          </div>

          {/* Funding instructions */}
          {!isFunded && (
            <div className="bg-black/[0.03] dark:bg-white/[0.03] border border-coda-border-subtle rounded-xl p-3 space-y-1.5">
              {isProductionCluster ? (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
                    <span className="text-coda-text-muted font-bold w-4">1.</span>
                    Click <strong className="text-coda-brand">Fund Wallet</strong> below to airdrop {gasToken} from the Solstice Network faucet
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
                    <span className="text-coda-text-muted font-bold w-4">2.</span>
                    Click <strong className="text-coda-brand">Activate Bank</strong> to deploy Token-2022 on-chain
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
                    <span className="text-coda-text-muted font-bold w-4">1.</span>
                    Copy the wallet address above
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
                    <span className="text-coda-text-muted font-bold w-4">2.</span>
                    Visit the Solana Faucet and paste the address
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
                    <span className="text-coda-text-muted font-bold w-4">3.</span>
                    Complete CAPTCHA, request airdrop
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-coda-text-secondary">
                    <span className="text-coda-text-muted font-bold w-4">4.</span>
                    Come back here and click <strong className="text-coda-brand">Activate Bank</strong>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Fund error */}
          {fundError && (
            <div className="bg-red-950/20 border border-red-800/50 rounded-lg p-2 flex items-center gap-2">
              <XCircle className="w-3 h-3 text-red-400 shrink-0" />
              <span className="text-[11px] font-mono text-red-400">{fundError}</span>
            </div>
          )}

          {/* Funded success message */}
          {isFunded && (
            <div className="bg-coda-brand-bg border border-coda-brand/20 rounded-xl p-2.5 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-coda-brand shrink-0" />
              <span className="text-[11px] font-mono text-coda-brand">
                {gasToken} detected! Ready to activate and deploy Token-2022.
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {isProductionCluster ? (
              <button
                onClick={handleFundWallet}
                disabled={funding || isFunded}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-amber-600 dark:text-amber-400 transition-colors"
              >
                {funding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                {funding ? 'Funding...' : isFunded ? 'Funded' : `Fund Wallet (100 ${gasToken})`}
              </button>
            ) : (
              <button
                onClick={handleOpenFaucet}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-coda-border-subtle rounded-lg text-xs font-mono text-coda-text-secondary hover:text-coda-text hover:border-coda-text-muted transition-colors"
              >
                <Globe className="w-3 h-3" />
                Open Solana Faucet
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            )}
            <button
              onClick={handleCheckBalance}
              disabled={checkingBalance}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-coda-border-subtle rounded-lg text-xs font-mono text-coda-text-muted hover:text-coda-text hover:border-coda-text-muted disabled:opacity-50 transition-colors"
            >
              {checkingBalance ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Check Balance
            </button>
            <button
              onClick={handleActivate}
              disabled={!isFunded || activating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-coda-brand hover:bg-coda-brand-dim disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-white transition-colors"
            >
              {activating ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Activating...
                </>
              ) : (
                <>
                  <ArrowRight className="w-3 h-3" />
                  Activate Bank
                </>
              )}
            </button>
          </div>

          {/* Polling indicator */}
          {faucetOpened && !isFunded && (
            <div className="flex items-center gap-2 text-[10px] font-mono text-coda-text-muted">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Auto-checking balance every 10s...
            </div>
          )}
        </div>
      )}

      {/* Error: retry button */}
      {card.status === 'error' && (
        <div className="mt-2 space-y-1">
          {card.detail && (
            <div className="text-[11px] font-mono text-red-500/80 dark:text-red-400/80">{card.detail}</div>
          )}
          <button
            onClick={onActivate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-300/50 dark:border-red-800/50 rounded-lg text-xs font-mono text-red-500 dark:text-red-400 hover:text-red-400 dark:hover:text-red-300 hover:border-red-400 dark:hover:border-red-700 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

// ── Bank Table Row ──────────────────────────────────────────
function BankRow({ bank, wallet, solBalance }: { bank: Bank; wallet?: WalletType; solBalance?: number }) {
  const [expanded, setExpanded] = useState(false);

  const statusStyles: Record<string, string> = {
    active: 'bg-coda-brand/20 text-coda-brand',
    wallet_created: 'bg-blue-500/20 text-blue-400',
    activating: 'bg-yellow-500/20 text-yellow-400',
    awaiting_funding: 'bg-yellow-500/20 text-yellow-400',
    onboarding: 'bg-yellow-500/20 text-yellow-400',
    suspended: 'bg-red-500/20 text-red-400',
  };

  return (
    <>
      <tr
        className="border-b border-coda-border/50 hover:bg-coda-surface-alt/30 cursor-pointer text-xs font-mono"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-coda-text font-medium">{bank.name}</td>
        <td className="px-4 py-3">
          <span className="px-1.5 py-0.5 bg-coda-surface-hover rounded text-coda-brand">{bank.short_code}</span>
        </td>
        <td className="px-4 py-3">
          {bank.swift_bic ? (
            <span className="px-1.5 py-0.5 bg-coda-surface-hover rounded text-blue-400">{bank.swift_bic}</span>
          ) : (
            <span className="text-coda-text-muted">--</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={`px-1.5 py-0.5 rounded ${statusStyles[bank.status] || 'bg-coda-surface-hover text-coda-text-muted'}`}>
            {bank.status}
          </span>
        </td>
        <td className="px-4 py-3 text-coda-text-secondary">{bank.jurisdiction}</td>
        <td className="px-4 py-3">
          {bank.solana_wallet_pubkey ? (
            <a
              href={explorerUrl(bank.solana_wallet_pubkey, 'address')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1"
            >
              {truncateAddress(bank.solana_wallet_pubkey)}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ) : (
            <span className="text-coda-text-muted">--</span>
          )}
        </td>
        <td className="px-4 py-3 text-coda-text">
          {solBalance !== undefined ? `${solBalance.toFixed(4)} ${gasToken}` : '--'}
        </td>
        <td className="px-4 py-3">
          {bank.token_mint_address ? (
            <a
              href={explorerUrl(bank.token_mint_address, 'address')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-500 dark:text-blue-400 hover:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1"
            >
              {truncateAddress(bank.token_mint_address)}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ) : (
            <span className="text-coda-text-muted">--</span>
          )}
        </td>
        <td className="px-4 py-3 text-coda-text">
          {wallet ? formatTokenAmount(wallet.balance_tokens) : '--'}
        </td>
        <td className="px-4 py-3">
          <span className="text-coda-text-secondary">{bank.token_symbol || '--'}</span>
          <button className="ml-2 text-coda-text-muted hover:text-coda-text-secondary" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-coda-border/50">
          <td colSpan={10} className="px-4 py-3 bg-coda-surface-alt/30">
            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div>
                <span className="text-coda-text-muted">Full Wallet Address:</span>
                <div className="text-blue-500 dark:text-blue-400 break-all mt-0.5">{bank.solana_wallet_pubkey || '--'}</div>
              </div>
              <div>
                <span className="text-coda-text-muted">Full Token Mint:</span>
                <div className="text-blue-500 dark:text-blue-400 break-all mt-0.5">{bank.token_mint_address || '--'}</div>
              </div>
              <div>
                <span className="text-coda-text-muted">Token Account (ATA):</span>
                <div className="text-blue-500 dark:text-blue-400 break-all mt-0.5">{wallet?.token_account_address || '--'}</div>
              </div>
              <div>
                <span className="text-coda-text-muted">{gasToken} Balance (live):</span>
                <div className="text-coda-text mt-0.5">{solBalance !== undefined && solBalance !== null ? `${solBalance.toFixed(4)} ${gasToken}` : (wallet ? `${(wallet.balance_lamports / 1_000_000_000).toFixed(4)} ${gasToken} (cached)` : '--')}</div>
              </div>
              <div className="col-span-2">
                <span className="text-coda-text-muted">Agent System Prompt:</span>
                <div className="text-coda-text-secondary mt-0.5 bg-coda-surface-alt/60 p-2 rounded text-[11px] leading-relaxed max-h-24 overflow-y-auto">
                  {bank.agent_system_prompt || 'Default agent prompt'}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Infrastructure Wallet Card ─────────────────────────────
function InfraWalletCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  name,
  code,
  role,
  walletAddress,
  solBalance,
  createdAt,
  linkedBank = false,
}: {
  icon: ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  label: string;
  name: string;
  code: string;
  role: string;
  walletAddress: string;
  solBalance: number;
  createdAt: string;
  linkedBank?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    copyToClipboard(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isFunded = solBalance >= 0.05;

  return (
    <div className="rounded-2xl border border-coda-border/30 bg-coda-surface-alt/20 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-4.5 h-4.5 ${iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-coda-text">{name}</span>
            <span className="px-1.5 py-0.5 bg-coda-surface-hover rounded text-[10px] font-mono text-coda-text-muted">{code}</span>
            {linkedBank && (
              <span className="px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-[10px] font-mono text-blue-400">Linked</span>
            )}
          </div>
          <span className="text-[10px] font-mono text-coda-text-muted capitalize">{label}</span>
        </div>
        <CheckCircle2 className="w-4 h-4 text-coda-brand shrink-0" />
      </div>

      {/* Wallet Address */}
      <div className="space-y-1">
        <span className="text-[10px] font-mono text-coda-text-muted">Wallet Address</span>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-blue-400 break-all leading-relaxed">
            {walletAddress}
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 p-1 rounded hover:bg-coda-surface-hover transition-colors"
            title="Copy address"
          >
            {copied ? (
              <CheckCircle2 className="w-3 h-3 text-coda-brand" />
            ) : (
              <Copy className="w-3 h-3 text-coda-text-muted" />
            )}
          </button>
          <a
            href={`https://explorer.solana.com/address/${walletAddress}?cluster=${import.meta.env.VITE_SOLANA_CLUSTER || 'devnet'}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1 rounded hover:bg-coda-surface-hover transition-colors"
            title="View on Solana Explorer"
          >
            <ExternalLink className="w-3 h-3 text-coda-text-muted" />
          </a>
        </div>
      </div>

      {/* SOL Balance + Info */}
      <div className="flex items-center justify-between pt-1 border-t border-coda-border/20">
        <div className="flex items-center gap-3">
          <div>
            <span className="text-[10px] font-mono text-coda-text-muted">{gasToken} Balance</span>
            <div className={`text-xs font-mono font-medium ${isFunded ? 'text-coda-brand' : 'text-amber-400'}`}>
              {solBalance.toFixed(4)} {gasToken}
            </div>
          </div>
          {!isFunded && !isProductionCluster && (
            <a
              href={`${import.meta.env.VITE_SOLANA_FAUCET_URL || 'https://faucet.solana.com'}/?address=${walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              <Wallet className="w-3 h-3" />
              Fund via Faucet
            </a>
          )}
          {!isFunded && isProductionCluster && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono text-amber-400">
              <Wallet className="w-3 h-3" />
              Fund via Solstice CLI
            </span>
          )}
        </div>
        <div className="text-right">
          <span className="text-[10px] font-mono text-coda-text-muted">
            {new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Network Fee Protocol Card (mandatory, enforced) ────────
function NetworkFeeProtocolCard() {
  const [feeInfo, setFeeInfo] = useState<{
    network_fee_sol: number;
    fee_model: string;
    fee_description: string;
    fees_wallet: { code: string; wallet_address: string; balance: number } | null;
  } | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);

  useEffect(() => {
    callServer<any>('/network-fee-info')
      .then(data => {
        if (data && !data.error) setFeeInfo(data);
      })
      .catch(() => {})
      .finally(() => setFeeLoading(false));
  }, []);

  return (
    <div className="dashboard-card overflow-hidden">
      <div className="px-4 py-3 border-b border-coda-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-3.5 h-3.5 text-amber-500" />
          <h2 className="text-sm font-medium dashboard-text">Network Fee Protocol</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-red-500/15 text-red-400 border border-red-500/20">
            <Shield className="w-3 h-3" />
            Mandatory &mdash; Enforced
          </span>
        </div>
      </div>
      <div className="px-4 py-4 space-y-4">
        {feeLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 text-coda-text-muted animate-spin" />
          </div>
        ) : (
          <>
            {/* Fee model + rate */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400">
                {gasToken} Gas-Layer Fee
              </span>
              <span className="text-[10px] text-coda-text-muted font-mono">
                {feeInfo ? `${feeInfo.network_fee_sol} ${gasToken} / settlement` : '\u2014'}
              </span>
            </div>

            {/* Enforcement notice */}
            <div className="flex items-start gap-2 bg-red-500/5 rounded-lg p-3 border border-red-500/15">
              <Shield size={14} className="text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-red-400 font-medium mb-1">
                  Network fees are mandatory and cannot be bypassed.
                </p>
                <p className="text-[11px] text-coda-text-secondary leading-relaxed">
                  Every settlement transaction requires a <code className="text-amber-400/80 bg-amber-500/10 px-1 rounded">SystemProgram.transfer</code> of {feeInfo?.network_fee_sol ?? 0.001} {gasToken} from the sender bank to the Solstice Network Fees wallet. If fee collection fails, the settlement will be blocked and the transaction will not complete. No agent or user can override this protocol-level requirement.
                </p>
              </div>
            </div>

            {/* Settlement methods grid */}
            <div>
              <label className="text-xs font-medium text-coda-text-secondary">Settlement Methods</label>
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {[
                  { method: 'pvp_burn_mint', label: 'PvP Burn-Mint', color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
                  { method: 'lockup_hard_finality', label: 'Lockup Finality', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
                  { method: 'lockup_reversal', label: 'Lockup Reversal', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
                ].map(({ method, label, color }) => (
                  <div key={method} className={`px-2 py-1.5 rounded-lg text-[10px] font-medium text-center border ${color}`}>
                    {label}
                  </div>
                ))}
              </div>
            </div>

            {/* Fees wallet info */}
            {feeInfo?.fees_wallet && (
              <div className="bg-black/[0.03] dark:bg-white/[0.04] rounded-lg p-3 border border-coda-border/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-coda-text-muted font-mono">Solstice Network Fees Wallet</span>
                  <span className="text-[10px] font-mono text-amber-400">{feeInfo.fees_wallet.balance?.toFixed(6) ?? '0'} {gasToken} collected</span>
                </div>
                <div className="text-[11px] font-mono text-coda-text-muted truncate" title={feeInfo.fees_wallet.wallet_address}>
                  {feeInfo.fees_wallet.wallet_address}
                </div>
              </div>
            )}

            {/* DB columns note */}
            <div className="flex items-start gap-2 bg-coda-brand/5 rounded-lg p-2.5 border border-coda-brand/10">
              <AlertTriangle size={12} className="text-coda-brand mt-0.5 shrink-0" />
              <p className="text-[10px] text-coda-text-muted leading-relaxed">
                Fee data is recorded per-transaction in <code className="text-coda-brand/70 bg-coda-brand/10 px-1 rounded">network_fee_sol</code>, <code className="text-coda-brand/70 bg-coda-brand/10 px-1 rounded">settlement_method</code>, and <code className="text-coda-brand/70 bg-coda-brand/10 px-1 rounded">settlement_memo</code> columns on the transactions table.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}