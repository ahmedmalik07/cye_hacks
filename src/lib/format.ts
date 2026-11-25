/** Whole-unit money for screens, e.g. "Rs 4,500". Amounts are stored in cents. */
export function formatMoney(cents: number, currency = "PKR") {
  const amount = Math.round(cents / 100);
  if (currency === "PKR") return `Rs ${amount.toLocaleString("en-PK")}`;
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    amount,
  );
}
