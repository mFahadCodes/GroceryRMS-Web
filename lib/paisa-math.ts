type TotalsInput = {
  subTotal: bigint;
  discountAmount?: bigint;
  discountPercent?: number;
  taxPercent?: number;
  isInclusive?: boolean;
  serviceChargePercent?: number;
  serviceChargeAmount?: bigint;
  adjustment?: bigint;
};

export type TotalsBreakdown = {
  subTotal: bigint;
  discountAmount: bigint;
  taxBase: bigint;
  taxAmount: bigint;
  serviceCharge: bigint;
  adjustment: bigint;
  grandTotal: bigint;
};

function percentAmount(base: bigint, percent: number): bigint {
  if (!Number.isFinite(percent) || percent <= 0) return 0n;
  const scaled = BigInt(Math.round(percent * 100));
  return (base * scaled) / 10000n;
}

function inclusiveTaxAmount(taxBase: bigint, taxPercent: number): bigint {
  if (!Number.isFinite(taxPercent) || taxPercent <= 0) return 0n;
  const taxRateBasisPoints = BigInt(Math.round(taxPercent * 100));
  return (taxBase * taxRateBasisPoints) / (10000n + taxRateBasisPoints);
}

export function calculatePaisaTotals(input: TotalsInput): TotalsBreakdown {
  const subTotal = input.subTotal;
  const adjustment = input.adjustment ?? 0n;

  const discountAmount =
    input.discountAmount !== undefined
      ? input.discountAmount
      : percentAmount(subTotal, input.discountPercent ?? 0);

  const taxBase = subTotal - discountAmount;
  const taxPercent = input.taxPercent ?? 0;

  const taxAmount = input.isInclusive
    ? inclusiveTaxAmount(taxBase, taxPercent)
    : percentAmount(taxBase, taxPercent);

  const serviceChargeBase = input.isInclusive ? taxBase : taxBase + taxAmount;
  const serviceCharge =
    input.serviceChargeAmount !== undefined
      ? input.serviceChargeAmount
      : percentAmount(serviceChargeBase, input.serviceChargePercent ?? 0);

  const grandTotal = input.isInclusive
    ? taxBase + serviceCharge + adjustment
    : taxBase + taxAmount + serviceCharge + adjustment;

  return {
    subTotal,
    discountAmount,
    taxBase,
    taxAmount,
    serviceCharge,
    adjustment,
    grandTotal,
  };
}
