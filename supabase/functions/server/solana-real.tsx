// ============================================================
// solana-real.tsx — Real Solana Devnet Operations for CODA
// ============================================================

import { Buffer } from "node:buffer";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction as _sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "npm:@solana/web3.js@1.98.0";

import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createBurnCheckedInstruction,
  getAssociatedTokenAddress,
  getAccount,
  getMintLen,
  createEnableRequiredMemoTransfersInstruction,
  createReallocateInstruction,
  ExtensionType,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "npm:@solana/spl-token@0.4.12";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const DEVNET_RPC = Deno.env.get("SOLANA_RPC_URL") || "https://api.devnet.solana.com";
const SOLANA_EXPLORER_URL = Deno.env.get("SOLANA_EXPLORER_URL") || "https://explorer.solana.com";
const SOLANA_CLUSTER = Deno.env.get("SOLANA_CLUSTER") || "devnet";
const SOLANA_FAUCET_URL = Deno.env.get("SOLANA_FAUCET_URL") || "https://faucet.solana.com";
export const TOKEN_DECIMALS = 6;
const MIN_SOL_BALANCE = 0.05 * LAMPORTS_PER_SOL; // 0.05 SOL minimum for token ops

// Network fee: 0.001 SOL per settlement (mirrors mainnet SOLSTICE gas fee)
export const NETWORK_FEE_SOL = 0.001;
const NETWORK_FEE_LAMPORTS = Math.round(NETWORK_FEE_SOL * LAMPORTS_PER_SOL);

function getConnection(): Connection {
  return new Connection(DEVNET_RPC, "confirmed");
}

/**
 * Validate that a lockup mint exists on-chain and has the expected authority.
 * Returns true if valid, false if stale/missing.
 */
export async function validateLockupMintAuthority(mintAddress: string, expectedAuthority: string): Promise<boolean> {
  try {
    const connection = getConnection();
    const mintPk = new PublicKey(mintAddress);
    const info = await connection.getAccountInfo(mintPk);
    if (!info || !info.data) return false;
    // Parse mint authority from Token-2022 account data (bytes 4-36 are mint authority)
    // Byte 0-3: coption (4 = Some), bytes 4-35 = authority pubkey
    const hasAuthority = info.data[0] === 1; // COption::Some
    if (!hasAuthority) return false;
    const authorityBytes = info.data.slice(4, 36);
    const authorityPk = new PublicKey(authorityBytes);
    return authorityPk.toBase58() === expectedAuthority;
  } catch (e) {
    console.log(`[lockup-mint] Validation failed: ${(e as Error).message}`);
    return false;
  }
}

// ── Polling-based send+confirm ────────────────────────────────
// Replaces sendAndConfirmTransaction which uses lastValidBlockHeight
// and fails on Solstice Network due to fast block production.
async function sendAndPollTransaction(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  _opts?: { commitment?: string },
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);

  const rawTx = tx.serialize();
  const signature = await connection.sendRawTransaction(rawTx, { skipPreflight: false });
  console.log(`[tx] Sent: ${signature} — polling for confirmation...`);

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await connection.getSignatureStatuses([signature]);
    const val = status?.value?.[0];
    if (val?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(val.err)}`);
    }
    if (val?.confirmationStatus === "confirmed" || val?.confirmationStatus === "finalized") {
      console.log(`[tx] Confirmed: ${signature} (${val.confirmationStatus})`);
      return signature;
    }
  }
  throw new Error(`Transaction confirmation timeout after 60s: ${signature}`);
}

export function encodeKeypair(keypair: Keypair): string {
  return btoa(String.fromCharCode(...keypair.secretKey));
}

export function decodeKeypair(encoded: string): Keypair {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return Keypair.fromSecretKey(bytes);
}

export function tokenSymbol(shortCode: string, currency: string = "USD"): string {
  return `${shortCode}-${currency}TD`;
}

// ============================================================
// Balance check utility (exported for server use)
// ============================================================

export async function checkBalance(connection: Connection, pubkey: PublicKey): Promise<number> {
  try {
    return await connection.getBalance(pubkey);
  } catch {
    return 0;
  }
}

export async function getSolBalance(walletPubkey: string): Promise<number> {
  const connection = getConnection();
  return checkBalance(connection, new PublicKey(walletPubkey));
}

// ============================================================
// FAUCET: Fund wallets via SystemProgram.transfer from a faucet keypair.
// On Solstice Network, requestAirdrop is not available — we use a
// pre-funded faucet wallet instead. On Devnet, falls back to requestAirdrop.
// Amount is in SOL/SNT (e.g. 100 = 100 SNT).
// ============================================================

export async function requestFaucet(walletPubkey: string, amountSol: number = 100): Promise<{ balance: number; txSignature: string }> {
  const connection = getConnection();
  const pubkey = new PublicKey(walletPubkey);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  // Try faucet keypair transfer first (Solstice Network)
  const faucetKeypairB64 = Deno.env.get("FAUCET_KEYPAIR");
  if (faucetKeypairB64) {
    console.log(`[faucet] Using faucet keypair transfer: ${amountSol} SNT to ${walletPubkey}`);
    const faucetKeypair = decodeKeypair(faucetKeypairB64);
    console.log(`[faucet] Faucet address: ${faucetKeypair.publicKey.toBase58()}`);

    // Send transfer and poll for confirmation (block height expiry workaround)
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: faucetKeypair.publicKey,
        toPubkey: pubkey,
        lamports,
      })
    );
    tx.recentBlockhash = blockhash;
    tx.feePayer = faucetKeypair.publicKey;
    tx.sign(faucetKeypair);

    const rawTx = tx.serialize();
    const signature = await connection.sendRawTransaction(rawTx, {
      skipPreflight: true,
      maxRetries: 5,
    });
    console.log(`[faucet] Sent tx: ${signature} — polling for status...`);

    // Poll for signature status instead of using confirmTransaction
    // (avoids block height expiry issues with high-latency connections)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusResp = await connection.getSignatureStatuses([signature]);
      const status = statusResp?.value?.[0];
      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
          console.log(`[faucet] ✓ Confirmed (${status.confirmationStatus}) after ${(i + 1) * 2}s`);
          const newBalance = await checkBalance(connection, pubkey);
          console.log(`[faucet] New balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SNT`);
          return { balance: newBalance, txSignature: signature };
        }
        console.log(`[faucet] Status: ${status.confirmationStatus || "processing"} (poll ${i + 1})`);
      }
    }
    throw new Error(`Transaction ${signature} not confirmed after 60s`);
  }

  // Fallback: requestAirdrop (Solana Devnet)
  console.log(`[faucet] No FAUCET_KEYPAIR — falling back to requestAirdrop: ${amountSol} SOL to ${walletPubkey}`);
  const signature = await connection.requestAirdrop(pubkey, lamports);
  console.log(`[faucet] Airdrop tx: ${signature} — waiting for confirmation...`);

  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");

  const newBalance = await checkBalance(connection, pubkey);
  console.log(`[faucet] ✓ Airdrop confirmed. New balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  return { balance: newBalance, txSignature: signature };
}

// ============================================================
// GENERATE-WALLET: Pure keypair generation, no network calls.
// Safe to call any time — always succeeds.
// ============================================================

export interface GenerateWalletResult {
  walletPubkey: string;
  keypairEncrypted: string;
}

export function generateWallet(): GenerateWalletResult {
  const keypair = Keypair.generate();
  return {
    walletPubkey: keypair.publicKey.toBase58(),
    keypairEncrypted: encodeKeypair(keypair),
  };
}

// ============================================================
// ACTIVATE-BANK: Network ops on an existing keypair.
// Requires SOL balance >= 0.05 SOL (manual faucet funding).
// Deploys Token-2022 mint + ATA + supply.
// Throws if insufficient SOL — no programmatic airdrop.
// ============================================================

export interface ActivateBankResult {
  tokenMintAddress: string;
  tokenSymbol: string;
  tokenAccountAddress: string;
  mintSignature: string;
  supplySignature: string;
  solBalance: number;
}

export async function activateBank(
  keypairEncrypted: string,
  shortCode: string,
  initialSupply: number,
): Promise<ActivateBankResult> {
  const connection = getConnection();
  const bankKeypair = decodeKeypair(keypairEncrypted);
  const pubkey = bankKeypair.publicKey;
  const pubkeyStr = pubkey.toBase58();

  // Step 1: Check SOL balance — require manual funding via faucet
  const balance = await checkBalance(connection, pubkey);
  console.log(`[activate-bank] ${shortCode} balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < MIN_SOL_BALANCE) {
    throw new Error(
      `Insufficient SOL balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL. ` +
      `Minimum 0.05 SOL required. Please fund wallet ${pubkeyStr} via ${SOLANA_FAUCET_URL}`
    );
  }

  console.log(`[activate-bank] ${shortCode} funded (${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL) — deploying tokens`);

  // Step 2: Create Token-2022 mint
  const mintKeypair = Keypair.generate();
  const mintLen = getMintLen([]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: pubkey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: mintRent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey, TOKEN_DECIMALS,
      pubkey, pubkey,
      TOKEN_2022_PROGRAM_ID
    )
  );

  const mintSignature = await sendAndPollTransaction(connection, createMintTx, [bankKeypair, mintKeypair]);
  console.log(`[activate-bank] ${shortCode} mint created: ${mintKeypair.publicKey.toBase58()}`);

  // Step 3: Create ATA with MemoTransfer enabled
  const ata = await getAssociatedTokenAddress(
    mintKeypair.publicKey, pubkey, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const createAtaTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      pubkey, ata, pubkey, mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  await sendAndPollTransaction(connection, createAtaTx, [bankKeypair]);
  console.log(`[activate-bank] ${shortCode} ATA created: ${ata.toBase58()}`);

  // Reallocate ATA to add space for MemoTransfer extension, then enable it
  const memoSetupTx = new Transaction().add(
    createReallocateInstruction(
      ata, pubkey, [ExtensionType.MemoTransfer], pubkey, [], TOKEN_2022_PROGRAM_ID
    ),
    createEnableRequiredMemoTransfersInstruction(
      ata, pubkey, [], TOKEN_2022_PROGRAM_ID
    )
  );
  await sendAndPollTransaction(connection, memoSetupTx, [bankKeypair]);
  console.log(`[activate-bank] ${shortCode} MemoTransfer enabled on ATA: ${ata.toBase58()}`);

  // Step 4: Mint initial supply
  // initialSupply = display dollars (e.g. 10_000_000 = $10M)
  // supplyBaseUnits = raw tokens (display * 10^decimals)
  const supplyBaseUnits = BigInt(initialSupply) * BigInt(10 ** TOKEN_DECIMALS);
  console.log(`[activate-bank] ${shortCode} minting: $${initialSupply.toLocaleString()} display = ${supplyBaseUnits.toString()} raw tokens (decimals=${TOKEN_DECIMALS})`);
  const mintToTx = new Transaction().add(
    createMintToInstruction(
      mintKeypair.publicKey, ata, pubkey,
      supplyBaseUnits, [], TOKEN_2022_PROGRAM_ID
    )
  );
  const supplySignature = await sendAndPollTransaction(connection, mintToTx, [bankKeypair]);
  console.log(`[activate-bank] ${shortCode} minted $${initialSupply.toLocaleString()} (${supplyBaseUnits.toString()} raw)`);

  // Final balance
  const finalBalance = await checkBalance(connection, pubkey);

  return {
    tokenMintAddress: mintKeypair.publicKey.toBase58(),
    tokenSymbol: tokenSymbol(shortCode),
    tokenAccountAddress: ata.toBase58(),
    mintSignature,
    supplySignature,
    solBalance: finalBalance,
  };
}

// ============================================================
// AGENT-EXECUTE: Atomic burn-and-mint PvP settlement
// ============================================================
// Each bank issues its OWN tokenized deposit token (JPM-USDTD,
// CITI-USDTD). Settlement is NOT a direct transfer — it is an
// ATOMIC SWAP: sender BURNS their tokens, receiver MINTS new
// tokens of their own type. This preserves the legal distinction
// that tokenized deposits are liabilities of the issuing bank.
// No bank should EVER hold another bank's tokens.
// ============================================================

export interface ExecuteTransferResult {
  signature: string;
  slot: number;
  blockTime: number | null;
}

/**
 * ISO 20022 pacs.009 memo fields for on-chain settlement audit trail.
 * Abbreviated keys map 1:1 to FI-to-FI Institution Credit Transfer paths.
 * Must serialize to ≤566 bytes (Solana memo limit).
 */
export interface ISO20022MemoFields {
  senderBic: string;       // DbtrAgt/FinInstnId/BICFI — short_code for demo banks
  senderName: string;      // DbtrAgt/FinInstnId/Nm
  receiverBic: string;     // CdtrAgt/FinInstnId/BICFI
  receiverName: string;    // CdtrAgt/FinInstnId/Nm
  settlementAmount: string; // IntrBkSttlmAmt — human-readable decimal, e.g. "500000.00"
  currency?: string;       // IntrBkSttlmAmt@Ccy — ISO 4217, default "USD"
  endToEndId?: string;     // PmtId/EndToEndId — defaults to transactionId
  remittanceInfo?: string; // RmtInf/Ustrd — optional free-text
}

export async function executeTransfer(
  senderKeypairEncrypted: string,
  senderMintAddress: string,
  receiverKeypairEncrypted: string,
  receiverMintAddress: string,
  rawAmount: bigint,
  purposeCode: string,
  transactionId: string,
  iso20022: ISO20022MemoFields,
): Promise<ExecuteTransferResult> {
  const connection = getConnection();

  // Decode both banks' keypairs
  const senderKeypair = decodeKeypair(senderKeypairEncrypted);
  const receiverKeypair = decodeKeypair(receiverKeypairEncrypted);

  const senderMint = new PublicKey(senderMintAddress);
  const receiverMint = new PublicKey(receiverMintAddress);

  // Sender's ATA (under sender's own mint)
  const senderAta = await getAssociatedTokenAddress(
    senderMint, senderKeypair.publicKey, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Receiver's ATA (under receiver's own mint — already exists from onboarding)
  const receiverAta = await getAssociatedTokenAddress(
    receiverMint, receiverKeypair.publicKey, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log(`[settlement] Atomic burn-and-mint PvP swap:`);
  console.log(`[settlement]   BURN  ${rawAmount.toString()} raw from sender ATA ${senderAta.toBase58().slice(0, 16)}... (mint: ${senderMintAddress.slice(0, 16)}...)`);
  console.log(`[settlement]   MINT  ${rawAmount.toString()} raw to receiver ATA ${receiverAta.toBase58().slice(0, 16)}... (mint: ${receiverMintAddress.slice(0, 16)}...)`);

  // ── Build ISO 20022 pacs.009 human-readable memo ──
  // Multi-line text format renders cleanly in Solana Explorer's
  // monospace "Data (UTF-8)" display while remaining machine-parseable.
  const creDtTm = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); // drop milliseconds
  const ccy = iso20022.currency ?? "USD";
  const rmtLine = iso20022.remittanceInfo
    ? `\nRemittance: ${iso20022.remittanceInfo}`
    : "";

  const memo = [
    `CODA pacs.009 Settlement`,
    `------------------------------------`,
    `TxId:    ${transactionId.slice(0, 8)}`,
    `Date:    ${creDtTm}`,
    `Amount:  ${iso20022.settlementAmount} ${ccy}`,
    `From:    ${iso20022.senderBic} (${iso20022.senderName})`,
    `To:      ${iso20022.receiverBic} (${iso20022.receiverName})`,
    `Purpose: ${purposeCode}`,
    ...(rmtLine ? [rmtLine.trim()] : []),
  ].join("\n");

  // Size guard: Solana memo program limit is ~566 bytes
  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > 566) {
    throw new Error(
      `ISO 20022 memo exceeds 566-byte Solana limit (${memoBytes.length} bytes). ` +
      `Reduce remittanceInfo or institution names.`
    );
  }
  console.log(`[settlement]   MEMO  ${memoBytes.length} bytes — ISO 20022 pacs.009 (human-readable)`);

  const tx = new Transaction();

  // Instruction 1: Memo (ISO 20022 audit trail)
  // Placed before burn so MemoTransfer extension on sender ATA is satisfied
  tx.add({
    keys: [{ pubkey: senderKeypair.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf-8"),
  });

  // Instruction 2: BURN sender's tokens (sender's mint, sender as owner)
  tx.add(
    createBurnCheckedInstruction(
      senderAta,                  // account to burn from
      senderMint,                 // mint
      senderKeypair.publicKey,    // owner / authority
      rawAmount,                  // amount in raw tokens
      TOKEN_DECIMALS,             // decimals
      [],                         // multi-signers
      TOKEN_2022_PROGRAM_ID       // program
    )
  );

  // Instruction 3: MINT receiver's tokens (receiver's mint, receiver as mint authority)
  tx.add(
    createMintToInstruction(
      receiverMint,               // mint
      receiverAta,                // destination ATA
      receiverKeypair.publicKey,  // mint authority
      rawAmount,                  // amount in raw tokens
      [],                         // multi-signers
      TOKEN_2022_PROGRAM_ID       // program
    )
  );

  // Sign with BOTH keypairs — sender signs burn + memo, receiver signs mint
  const signature = await sendAndPollTransaction(
    connection, tx,
    [senderKeypair, receiverKeypair],
    { commitment: "confirmed" }
  );

  // Fetch transaction details for slot/blockTime
  const txInfo = await connection.getTransaction(signature, {
    commitment: "confirmed", maxSupportedTransactionVersion: 0,
  });

  console.log(`[settlement] Atomic PvP confirmed: ${signature}`);
  console.log(`[settlement]   slot=${txInfo?.slot ?? "?"}, blockTime=${txInfo?.blockTime ?? "?"}`);

  return {
    signature,
    slot: txInfo?.slot ?? 0,
    blockTime: txInfo?.blockTime ?? null,
  };
}

// ============================================================
// UTILITY
// ============================================================

export async function getTokenBalance(walletPubkey: string, mintAddress: string): Promise<bigint> {
  const connection = getConnection();
  const ata = await getAssociatedTokenAddress(
    new PublicKey(mintAddress), new PublicKey(walletPubkey), false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
  );
  try {
    const account = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
    return account.amount;
  } catch {
    return BigInt(0);
  }
}

export function explorerUrl(type: "tx" | "address", value: string): string {
  const clusterParam = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
  if (type === "tx") return `${SOLANA_EXPLORER_URL}/tx/${value}${clusterParam}`;
  return `${SOLANA_EXPLORER_URL}/address/${value}${clusterParam}`;
}

// ============================================================
// DEPOSIT TOKEN BURN / MINT — Decomposed halves of PvP swap
// Used by the lockup flow where burn and mint happen at
// different lifecycle points (soft settle vs hard finality).
// ============================================================

/**
 * Burn a bank's deposit tokens (e.g. JPM-USDTD).
 * The bank signs as owner/authority on its own ATA.
 * Includes a memo instruction for audit trail.
 */
export async function burnDepositToken(
  bankKeypairEncrypted: string,
  bankMintAddress: string,
  rawAmount: bigint,
  memo: string,
): Promise<{ signature: string; slot: number }> {
  const connection = getConnection();
  const bankKp = decodeKeypair(bankKeypairEncrypted);
  const bankPk = bankKp.publicKey;
  const mint = new PublicKey(bankMintAddress);

  const ata = await getAssociatedTokenAddress(
    mint, bankPk, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > 566) {
    throw new Error(`Burn memo exceeds 566-byte limit (${memoBytes.length} bytes)`);
  }

  const tx = new Transaction();
  // Memo first (required by MemoTransfer extension on ATA)
  tx.add({
    keys: [{ pubkey: bankPk, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf-8"),
  });
  tx.add(
    createBurnCheckedInstruction(
      ata, mint, bankPk, rawAmount, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID,
    ),
  );

  const signature = await sendAndPollTransaction(connection, tx, [bankKp], { commitment: "confirmed" });
  const txInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

  console.log(`[burn-deposit] Burned ${rawAmount.toString()} raw from ${ata.toBase58().slice(0, 16)}... — sig: ${signature.slice(0, 20)}...`);
  return { signature, slot: txInfo?.slot ?? 0 };
}

/**
 * Mint deposit tokens to a bank's ATA (e.g. CITI-USDTD).
 * The bank signs as mint authority on its own mint.
 * Used for hard finality (lockup settle) and reversal (re-mint to sender).
 */
export async function mintDepositToken(
  bankKeypairEncrypted: string,
  bankMintAddress: string,
  rawAmount: bigint,
  memo: string,
): Promise<{ signature: string; slot: number }> {
  const connection = getConnection();
  const bankKp = decodeKeypair(bankKeypairEncrypted);
  const bankPk = bankKp.publicKey;
  const mint = new PublicKey(bankMintAddress);

  const ata = await getAssociatedTokenAddress(
    mint, bankPk, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > 566) {
    throw new Error(`Mint memo exceeds 566-byte limit (${memoBytes.length} bytes)`);
  }

  const tx = new Transaction();
  tx.add({
    keys: [{ pubkey: bankPk, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf-8"),
  });
  tx.add(
    createMintToInstruction(
      mint, ata, bankPk, rawAmount, [], TOKEN_2022_PROGRAM_ID,
    ),
  );

  const signature = await sendAndPollTransaction(connection, tx, [bankKp], { commitment: "confirmed" });
  const txInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

  console.log(`[mint-deposit] Minted ${rawAmount.toString()} raw to ${ata.toBase58().slice(0, 16)}... — sig: ${signature.slice(0, 20)}...`);
  return { signature, slot: txInfo?.slot ?? 0 };
}

// ============================================================
// SHARED LOCKUP MINT — Single network-wide escrow token (Task 118)
// ============================================================
// Uses a single LOCKUP-USTB Token-2022 mint with permanent_delegate
// set to the BNY custodian. All lockup settlements mint to the same
// token type. The custodian's ATA holds tokens from all active
// lockups simultaneously; the lockup_tokens DB table tracks
// per-transaction amounts.
// ============================================================

export const LOCKUP_TOKEN_SYMBOL = "LOCKUP-USTB";

/**
 * Create the shared LOCKUP-USTB mint (one-time setup).
 * Token-2022 with PermanentDelegate = BNY custodian.
 * Also creates the custodian's ATA for the new mint.
 */
export async function createLockupMint(
  custodianKeypairEncrypted: string,
): Promise<{ mintAddress: string; ataAddress: string; mintSignature: string }> {
  const connection = getConnection();
  const custodianKp = decodeKeypair(custodianKeypairEncrypted);
  const custodianPk = custodianKp.publicKey;

  console.log(`[lockup-mint] Creating shared ${LOCKUP_TOKEN_SYMBOL} mint — permanent_delegate: ${custodianPk.toBase58().slice(0, 16)}...`);

  const mintKeypair = Keypair.generate();
  const mintLen = getMintLen([ExtensionType.PermanentDelegate]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: custodianPk,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: mintRent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializePermanentDelegateInstruction(
      mintKeypair.publicKey, custodianPk, TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mintKeypair.publicKey, TOKEN_DECIMALS,
      custodianPk, custodianPk,
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  const mintSignature = await sendAndPollTransaction(
    connection, createMintTx, [custodianKp, mintKeypair],
  );
  console.log(`[lockup-mint] ${LOCKUP_TOKEN_SYMBOL} mint created: ${mintKeypair.publicKey.toBase58()}`);

  const ata = await getAssociatedTokenAddress(
    mintKeypair.publicKey, custodianPk, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const createAtaTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      custodianPk, ata, custodianPk, mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  await sendAndPollTransaction(connection, createAtaTx, [custodianKp]);
  console.log(`[lockup-mint] ${LOCKUP_TOKEN_SYMBOL} ATA created for BNY: ${ata.toBase58()}`);

  return {
    mintAddress: mintKeypair.publicKey.toBase58(),
    ataAddress: ata.toBase58(),
    mintSignature,
  };
}

/**
 * Phase 1: Mint LOCKUP-USTB tokens to the BNY custodian's escrow ATA.
 * Called during lockup initiation after sender's tokens are burned.
 */
export async function mintLockupToEscrow(
  custodianKeypairEncrypted: string,
  lockupMintAddress: string,
  rawAmount: bigint,
  memo: string,
): Promise<{ signature: string; slot: number }> {
  const connection = getConnection();
  const custodianKp = decodeKeypair(custodianKeypairEncrypted);
  const custodianPk = custodianKp.publicKey;
  const lockupMint = new PublicKey(lockupMintAddress);

  const ata = await getAssociatedTokenAddress(
    lockupMint, custodianPk, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const memoBytes = new TextEncoder().encode(memo);
  if (memoBytes.length > 566) {
    throw new Error(`Lockup mint memo exceeds 566-byte limit (${memoBytes.length} bytes)`);
  }

  const tx = new Transaction();
  tx.add({
    keys: [{ pubkey: custodianPk, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf-8"),
  });
  tx.add(
    createMintToInstruction(
      lockupMint, ata, custodianPk, rawAmount, [], TOKEN_2022_PROGRAM_ID,
    ),
  );

  const signature = await sendAndPollTransaction(connection, tx, [custodianKp], { commitment: "confirmed" });
  const txInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

  console.log(`[lockup-escrow] Minted ${rawAmount.toString()} ${LOCKUP_TOKEN_SYMBOL} to escrow — sig: ${signature.slice(0, 20)}...`);
  return { signature, slot: txInfo?.slot ?? 0 };
}

/**
 * Phase 2 / Reversal: Burn LOCKUP-USTB tokens from the BNY custodian's ATA.
 * Uses permanent_delegate authority — only custodian keypair signs.
 */
export async function burnLockupFromEscrow(
  custodianKeypairEncrypted: string,
  lockupMintAddress: string,
  rawAmount: bigint,
  memo: string,
): Promise<{ signature: string; slot: number }> {
  const connection = getConnection();
  const custodianKp = decodeKeypair(custodianKeypairEncrypted);
  const custodianPk = custodianKp.publicKey;
  const lockupMint = new PublicKey(lockupMintAddress);

  const ata = await getAssociatedTokenAddress(
    lockupMint, custodianPk, false,
    TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const memoBytes = new TextEncoder().encode(memo);
  const includeMemo = memoBytes.length <= 566;

  const tx = new Transaction();
  if (includeMemo) {
    tx.add({
      keys: [{ pubkey: custodianPk, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, "utf-8"),
    });
  }
  tx.add(
    createBurnCheckedInstruction(
      ata, lockupMint, custodianPk, rawAmount, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID,
    ),
  );

  const signature = await sendAndPollTransaction(connection, tx, [custodianKp], { commitment: "confirmed" });
  const txInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

  console.log(`[lockup-escrow] Burned ${rawAmount.toString()} ${LOCKUP_TOKEN_SYMBOL} from escrow — sig: ${signature.slice(0, 20)}...`);
  return { signature, slot: txInfo?.slot ?? 0 };
}

// ============================================================
// NETWORK FEE — SOL gas-layer fee collection
// ============================================================
// Collects a small SOL fee on every settlement and routes it to
// the Solstice Network Fees wallet. On Devnet, SOL stands in for
// the mainnet SOLSTICE native token. The fee is sent as a
// separate transaction (not atomic with settlement) — acceptable
// for demo purposes since 0.001 SOL is negligible.
// ============================================================

export interface NetworkFeeResult {
  signature: string;
  feeSol: number;
  feeLamports: number;
}

/**
 * Send the network fee (0.001 SOL) from a bank wallet to the
 * Solstice Network Fees wallet. Mandatory — failures block settlement.
 * Includes pre-flight SOL balance check for clean error reporting.
 */
export async function sendNetworkFee(
  senderKeypairEncrypted: string,
  feesWalletPubkey: string,
): Promise<NetworkFeeResult> {
  const connection = getConnection();
  const senderKp = decodeKeypair(senderKeypairEncrypted);

  // Pre-flight SOL balance check — fail fast with a clean message
  // instead of a cryptic Solana transaction error
  const MIN_SOL_FOR_FEE = 0.002; // 0.001 fee + ~0.001 for tx gas
  const senderLamports = await checkBalance(connection, senderKp.publicKey);
  const senderSol = senderLamports / LAMPORTS_PER_SOL;
  if (senderSol < MIN_SOL_FOR_FEE) {
    const walletAddr = senderKp.publicKey.toBase58();
    throw new Error(
      `Insufficient SOL for network fee: ${senderSol.toFixed(6)} SOL in wallet ${walletAddr.slice(0, 16)}... ` +
      `Need ≥${MIN_SOL_FOR_FEE} SOL (${NETWORK_FEE_SOL} fee + ~0.001 tx gas). ` +
      `Fund via ${SOLANA_FAUCET_URL}`
    );
  }

  const feeInstruction = SystemProgram.transfer({
    fromPubkey: senderKp.publicKey,
    toPubkey: new PublicKey(feesWalletPubkey),
    lamports: NETWORK_FEE_LAMPORTS,
  });

  const tx = new Transaction().add(feeInstruction);
  const signature = await sendAndPollTransaction(
    connection, tx, [senderKp],
    { commitment: "confirmed" },
  );

  console.log(`[network-fee] ✓ ${NETWORK_FEE_SOL} SOL (${NETWORK_FEE_LAMPORTS} lamports) → ${feesWalletPubkey.slice(0, 16)}... — sig: ${signature.slice(0, 20)}...`);

  return {
    signature,
    feeSol: NETWORK_FEE_SOL,
    feeLamports: NETWORK_FEE_LAMPORTS,
  };
}