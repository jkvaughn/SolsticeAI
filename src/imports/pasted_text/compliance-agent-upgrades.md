TASK 127 — Compliance Agent Upgrades (Travel Rule + OFAC Watchlist + SAR Draft)

PROJECT_STATUS.md is the source of truth. Read it in full before starting.
Also read the agent architecture: Concord handles compliance checks, Fermata handles risk,
Cadenza handles dispute resolution and escalation briefings.

Three targeted compliance upgrades. Each is independent — implement in order.

--- UPGRADE 1: TRAVEL RULE PAYLOAD ---

Backend (index.tsx):
- In handleInitiatePayment(), after creating the transaction row, if amount >= 3000:
  Build a travel_rule_payload object in IVMS 101 format:
  {
    standard: 'IVMS101',
    version: '1.0',
    originator: { name: sender.name, accountNumber: sender.wallet_address, bic: sender.swift_bic },
    beneficiary: { name: receiver.name, accountNumber: receiver.wallet_address, bic: receiver.swift_bic },
    amount: transaction.amount,
    currency: 'USD',
    purposeCode: transaction.purpose_code,
    threshold: 3000,
    status: 'transmitted',
    transmittedAt: new Date().toISOString()
  }
  Write this as JSONB to transactions.travel_rule_payload column (add column if needed).
- If amount < 3000: write { status: 'not_required', threshold: 3000, reason: 'Below FinCEN $3,000 threshold' }

Frontend (TransactionDetail.tsx):
- Add a new section after On-Chain Settlement: "Travel Rule Compliance"
- If travel_rule_payload.status = 'transmitted': show green badge "Travel Rule: Transmitted",
  then a collapsible panel showing the IVMS 101 fields in a clean key-value table.
  Fields: Standard, Originator (name + BIC), Beneficiary (name + BIC), Amount, Purpose, Transmitted At.
- If status = 'not_required': show gray badge "Travel Rule: Not Required" with reason text.
- Style: dashboard-card-subtle, text-coda-text, all CODA tokens.

DB column to add: transactions.travel_rule_payload JSONB nullable

--- UPGRADE 2: SIMULATED OFAC WATCHLIST ---

DB: Create table simulated_watchlist:
  id UUID PK DEFAULT gen_random_uuid()
  entity_name TEXT NOT NULL
  bic_code TEXT  (nullable — not all entities have BICs)
  wallet_address TEXT (nullable)
  list_type TEXT DEFAULT 'OFAC_SDN' (OFAC_SDN | UN_CONSOLIDATED | EU_CONSOLIDATED)
  status TEXT DEFAULT 'active' (active | removed)
  added_at TIMESTAMPTZ DEFAULT now()
  reason TEXT

Seed with ~20 rows: 17 clean fictional entities, 3 flagged:
  - { entity_name: 'Rogue State Bank', bic_code: 'RGSTUS33', list_type: 'OFAC_SDN', reason: 'State-sponsored financial institution' }
  - { entity_name: 'Shadow Capital Ltd', bic_code: 'SHCPKY22', list_type: 'UN_CONSOLIDATED', reason: 'Proliferation financing' }
  - { entity_name: 'Phantom Trust Co', bic_code: 'PHTRRU44', list_type: 'OFAC_SDN', reason: 'Sanctions evasion network' }

Backend (index.tsx — coreComplianceCheck):
- Check 5 (currently hardcoded pass): replace with a Supabase query:
  SELECT * FROM simulated_watchlist WHERE (bic_code = sender_bic OR bic_code = receiver_bic)
  AND status = 'active'
- If match found: check fails. Set check_result=false, details including list_type and reason.
  The Concord narrative should reference the specific list and reason.
- If no match: check passes (current behavior).

Proving Ground (proving-ground.tsx):
- Update C1 (Unknown Jurisdiction) scenario to optionally use a watchlist-flagged BIC
  as the sender, making the OFAC check the specific failure reason rather than just jurisdiction.
  Add a new scenario C6: 'OFAC Hit — Sanctioned Counterparty' that uses SHCPKY22 as receiver BIC.

--- UPGRADE 3: SAR DRAFT IN CADENZA BRIEFING ---

Backend (cadenza-prompts.ts — buildCadenzaEscalationPrompt):
- Add a SAR DRAFT section to the Gemini prompt for get_briefing:
  Append to the existing prompt: 'After your analysis, generate a SAR (Suspicious Activity Report)
  draft in the following format:
  SAR_DRAFT_START
  Subject: {entity name and type}
  Transaction: {amount, corridor, date}
  Suspicious Indicators: {bullet list of specific red flags from your analysis}
  Typology: {select one: structuring | velocity_abuse | sanctions_evasion | duplicate_pattern | anomalous_behavior}
  Recommended Action: {file | monitor | dismiss}
  SAR_DRAFT_END
  Keep the SAR draft factual and brief — 3-5 bullet indicators maximum.'

Backend (index.tsx — get_briefing action):
- After getting Gemini response, parse out SAR_DRAFT_START...SAR_DRAFT_END block.
  Store parsed SAR draft in the briefing response as a separate field: { briefing: string, sarDraft: object | null }

Frontend (EscalationDashboard.tsx):
- In the AI briefing panel, after the main briefing text, if sarDraft is present:
  Show a collapsible "SAR Draft" section with amber-500/10 background, amber border.
  Header: amber ⚠ icon + "SAR DRAFT — Not Filed" label + "For Review Only" chip.
  Body: structured display of Subject, Transaction, Indicators (bullet list), Typology badge,
  Recommended Action badge (file=red, monitor=amber, dismiss=gray).
  Footer: "This is a simulation draft. No actual SAR has been filed with FinCEN."
  in text-coda-text-faint text-xs italic.

Report TASK_COMPLETE with:
- DB column transactions.travel_rule_payload created and seeded correctly
- simulated_watchlist table created with 20 rows (3 flagged)
- Concord Check 5 now queries watchlist (not hardcoded pass)
- SAR draft appearing in EscalationDashboard briefing panel when Cadenza escalates
- Proving Ground C6 scenario added
- All files modified listed
- No hardcoded hex colors