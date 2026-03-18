// yield-engine.tsx — Pure yield accrual utility for the three-token lockup flow
// All math uses BIGINT with 6 decimal precision (1 USDTD = 1_000_000 raw units)
// Simple interest: yield = principal x (rateBps / 10_000) x (elapsed_seconds / 31_536_000)

const SECONDS_PER_YEAR = 31_536_000n; // 365 days
const BPS_DENOMINATOR = 10_000n;

/**
 * Calculate accrued yield since a given start time.
 *
 * @param principalRaw   - Principal amount in raw BIGINT units (6 decimals, e.g. 1_000_000_000_000n = $1M)
 * @param rateBps        - Annual interest rate in basis points (e.g. 525 = 5.25%)
 * @param startTime      - ISO 8601 timestamp of last calculation (or lockup start)
 * @param now            - Current ISO 8601 timestamp
 * @returns              - Accrued yield in raw BIGINT units (6 decimals)
 */
export function calculateAccruedYield(
  principalRaw: bigint,
  rateBps: number,
  startTime: string,
  now: string,
): bigint {
  const startMs = new Date(startTime).getTime();
  const nowMs = new Date(now).getTime();

  if (nowMs <= startMs) return 0n;

  const elapsedSeconds = BigInt(Math.floor((nowMs - startMs) / 1000));
  if (elapsedSeconds <= 0n) return 0n;

  const rate = BigInt(rateBps);

  // yield = principal * rate * elapsed / (BPS_DENOMINATOR * SECONDS_PER_YEAR)
  // Order of operations: multiply first, divide last to preserve precision
  const yieldAmount =
    (principalRaw * rate * elapsedSeconds) /
    (BPS_DENOMINATOR * SECONDS_PER_YEAR);

  return yieldAmount;
}

/**
 * Format a raw BIGINT amount (6 decimals) as a human-readable dollar string.
 * e.g. 2_166_000n -> "$2.17"
 */
export function formatYieldUsd(rawAmount: bigint): string {
  const whole = rawAmount / 1_000_000n;
  const frac = rawAmount % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 2);
  return `$${whole}.${fracStr}`;
}
