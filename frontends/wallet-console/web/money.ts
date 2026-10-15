/**
 * Money helpers in integer cents (bigint), never floating point — the same rule the backend follows.
 * The API takes strings with exactly two decimals.
 */

const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** "25" → "25.00", "7.5" → "7.50". Returns null if it is not a non-negative decimal. */
const normalize = (raw: string): string | null => {
  const value = raw.trim().replace(",", ".");
  if (!DECIMAL.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
};

const toCents = (amount: string): bigint => {
  const [whole = "0", fraction = "00"] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};

const fromCents = (cents: bigint): string => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
};

const multiply = (amount: string, factor: bigint) => fromCents(toCents(amount) * factor);

/** "1234.50" → "1.234,50" for display only. */
const display = (amount: string | null | undefined, currency?: string) => {
  if (amount === null || amount === undefined) return "—";
  const [whole = "0", fraction = "00"] = amount.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount.startsWith("-") ? "−" : ""}${grouped},${fraction}${currency ? ` ${currency}` : ""}`;
};

export { display, fromCents, multiply, normalize, toCents };
