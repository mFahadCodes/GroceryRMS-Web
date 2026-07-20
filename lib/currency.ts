/**
 * Currency helpers — ALL money in DB/API is BigInt paisa (1 PKR = 100 paisa).
 * Use formatPKR() in UI; never divide money in queries or business logic.
 */

const PAISA_PER_PKR = 100n;

export function toPaisa(pkr: number): bigint {
  return BigInt(Math.round(pkr * Number(PAISA_PER_PKR)));
}

export function toPKR(paisa: bigint): number {
  return Number(paisa) / Number(PAISA_PER_PKR);
}

export function formatPKR(paisa: bigint, symbol = "Rs."): string {
  const pkr = toPKR(paisa);
  return `${symbol} ${pkr.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
