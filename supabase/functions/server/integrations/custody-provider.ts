// ============================================================
// Custody Provider — Digital Asset Custody Interface (Task 165)
//
// Defines the ICustodyProvider contract and a MockCustodyProvider
// for sandbox testing. Live providers (e.g. Fireblocks, BitGo,
// Anchorage) will implement ICustodyProvider when wired in.
// ============================================================

export interface CustodyBalance {
  asset_type: string;
  balance: number;
  usd_equivalent: number;
}

export interface CustodyAttestation {
  balance: number;
  attestation_hash: string;
  fetched_at: string;
}

export interface ICustodyProvider {
  getBalances(bankId: string): Promise<CustodyBalance[]>;
  getAttestation(bankId: string, assetType: string): Promise<CustodyAttestation>;
  getTransactionStatus(txId: string): Promise<{ status: string }>;
}

/**
 * Mock custody provider for sandbox/testing mode.
 * Returns configurable mock data — defaults to a standard
 * portfolio of BTC, ETH, USDC holdings.
 */
export class MockCustodyProvider implements ICustodyProvider {
  private overrides: Partial<{ balances: CustodyBalance[] }>;

  constructor(overrides: Partial<{ balances: CustodyBalance[] }> = {}) {
    this.overrides = overrides;
  }

  async getBalances(_bankId: string): Promise<CustodyBalance[]> {
    if (this.overrides.balances) return this.overrides.balances;

    return [
      { asset_type: 'BTC', balance: 12.5, usd_equivalent: 812_500 },
      { asset_type: 'ETH', balance: 250.0, usd_equivalent: 500_000 },
      { asset_type: 'USDC', balance: 2_000_000, usd_equivalent: 2_000_000 },
    ];
  }

  async getAttestation(_bankId: string, assetType: string): Promise<CustodyAttestation> {
    const balances = await this.getBalances(_bankId);
    const match = balances.find((b) => b.asset_type === assetType);
    const balance = match?.balance ?? 0;

    // Simulate an attestation hash (SHA-256-like hex string)
    const hash = Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');

    return {
      balance,
      attestation_hash: hash,
      fetched_at: new Date().toISOString(),
    };
  }

  async getTransactionStatus(_txId: string): Promise<{ status: string }> {
    return { status: 'confirmed' };
  }
}
