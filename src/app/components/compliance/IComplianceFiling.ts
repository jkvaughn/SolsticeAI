// ============================================================
// IComplianceFiling — Interface for future Hummingbird integration
//
// Defines the contract for compliance filing providers.
// Currently uses internal mock; will be swapped for Hummingbird,
// Unit21, or similar when live integrations are wired in.
// ============================================================

export interface IComplianceFiling {
  createFiling(tx: any, type: 'CTR' | 'SAR'): Promise<{ filing_id: string; case_url?: string }>;
  checkStatus(filing_id: string): Promise<{ status: string }>;
}

export interface ComplianceFiling {
  id: string;
  bank_id: string | null;
  transaction_id: string | null;
  filing_type: 'CTR' | 'SAR' | 'OTHER';
  status: 'auto_generated' | 'under_review' | 'filed' | 'dismissed';
  amount: number | null;
  trigger_reason: string | null;
  filed_by: string | null;
  filed_at: string | null;
  external_case_url: string | null;
  external_tracking_id: string | null;
  created_at: string;
}
