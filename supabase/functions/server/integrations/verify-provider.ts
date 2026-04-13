// ============================================================
// Verify Provider — Account Verification Interface (Task 158)
//
// Defines the IVerifyProvider contract and a MockVerifyProvider
// for sandbox testing. Live providers (e.g. Plaid, Moov, SynapseFi)
// will implement IVerifyProvider when wired in.
// ============================================================

export interface VerifyResult {
  provider: string;
  account_open: boolean;
  name_match: 'exact' | 'partial' | 'no_match' | 'not_checked';
  currency_eligible: boolean;
  recent_activity: boolean;
  passed: boolean;
  verified_at: string;
}

export interface IVerifyProvider {
  verify(transaction: any, senderBank: any, receiverBank: any): Promise<VerifyResult>;
}

/**
 * Mock verify provider for sandbox/testing mode.
 * Returns configurable responses — defaults to all-pass.
 */
export class MockVerifyProvider implements IVerifyProvider {
  private overrides: Partial<VerifyResult>;

  constructor(overrides: Partial<VerifyResult> = {}) {
    this.overrides = overrides;
  }

  async verify(_tx: any, _sender: any, _receiver: any): Promise<VerifyResult> {
    const base: VerifyResult = {
      provider: 'mock',
      account_open: true,
      name_match: 'exact',
      currency_eligible: true,
      recent_activity: true,
      passed: true,
      verified_at: new Date().toISOString(),
    };

    // Apply overrides
    const result = { ...base, ...this.overrides };

    // Recompute passed based on individual fields (unless explicitly overridden)
    if (this.overrides.passed === undefined) {
      result.passed =
        result.account_open &&
        result.name_match !== 'no_match' &&
        result.currency_eligible &&
        result.provider !== 'not_found';
    }

    return result;
  }
}
