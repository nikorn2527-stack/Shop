type Transaction = { type: string; amount: number };

export function reportTransactionLabel(row: Transaction, fallback: string): string {
  return row.type === "refund" && row.amount > 0 ? "คืนเงินจากยกเลิกบิล" : fallback;
}

/** Card returns debit the wallet; sale cancellation refunds credit it. */
export function hospitalTransactionRows<T extends Transaction>(rows: readonly T[], preset: string): T[] {
  return preset === "refund"
    ? rows.filter(row => row.type === "refund" && row.amount < 0)
    : [...rows];
}

export function refundReportSummary(rows: readonly Transaction[]) {
  const returns = rows.filter(row => row.type === "refund" && row.amount < 0);
  const credits = rows.filter(row => row.type === "refund" && row.amount > 0);
  return [
    { type: "refund" as const, label: "คืนบัตรเงินสด", amount: -returns.reduce((sum, row) => sum + row.amount, 0), count: returns.length, sign: "-" as const },
    { type: "refund" as const, label: "คืนเงินจากยกเลิกบิล", amount: credits.reduce((sum, row) => sum + row.amount, 0), count: credits.length, sign: "+" as const },
  ];
}
