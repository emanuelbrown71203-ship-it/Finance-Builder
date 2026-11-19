/**
 * The app’s own category list. Bank data (Plaid) is mapped onto these so the
 * rest of the app never depends on a provider’s taxonomy.
 */

export type CategoryGroup = "income" | "spending" | "transfer";

export type CategoryKey =
  | "income"
  | "housing"
  | "utilities"
  | "groceries"
  | "dining"
  | "transport"
  | "shopping"
  | "entertainment"
  | "health"
  | "personal"
  | "travel"
  | "insurance"
  | "loans"
  | "giving"
  | "fees"
  | "other"
  | "transfer";

export type Category = { key: CategoryKey; label: string; group: CategoryGroup };

export const CATEGORIES: Category[] = [
  { key: "income", label: "Income", group: "income" },
  { key: "housing", label: "Home & rent", group: "spending" },
  { key: "utilities", label: "Utilities", group: "spending" },
  { key: "groceries", label: "Groceries", group: "spending" },
  { key: "dining", label: "Restaurants & coffee", group: "spending" },
  { key: "transport", label: "Car & transit", group: "spending" },
  { key: "shopping", label: "Shopping", group: "spending" },
  { key: "entertainment", label: "Entertainment", group: "spending" },
  { key: "health", label: "Health", group: "spending" },
  { key: "personal", label: "Personal care", group: "spending" },
  { key: "travel", label: "Travel", group: "spending" },
  { key: "insurance", label: "Insurance", group: "spending" },
  { key: "loans", label: "Loan payments", group: "spending" },
  { key: "giving", label: "Gifts & donations", group: "spending" },
  { key: "fees", label: "Fees & interest", group: "spending" },
  { key: "other", label: "Everything else", group: "spending" },
  { key: "transfer", label: "Transfers", group: "transfer" },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export function category(key: string): Category {
  return BY_KEY.get(key as CategoryKey) ?? BY_KEY.get("other")!;
}

export function isCategoryKey(key: string): key is CategoryKey {
  return BY_KEY.has(key as CategoryKey);
}

export const SPENDING_CATEGORIES = CATEGORIES.filter((c) => c.group === "spending");

/**
 * Maps Plaid’s personal_finance_category onto ours.
 * https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv
 */
export function categoryFromPlaid(primary?: string | null, detailed?: string | null): CategoryKey {
  const d = detailed ?? "";
  switch (primary) {
    case "INCOME":
      return "income";
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return "transfer";
    case "LOAN_PAYMENTS":
      // Paying off a card moves money between your own accounts.
      return d === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" ? "transfer" : "loans";
    case "BANK_FEES":
      return "fees";
    case "ENTERTAINMENT":
      return "entertainment";
    case "FOOD_AND_DRINK":
      return d === "FOOD_AND_DRINK_GROCERIES" ? "groceries" : "dining";
    case "GENERAL_MERCHANDISE":
      return "shopping";
    case "HOME_IMPROVEMENT":
      return "housing";
    case "MEDICAL":
      return "health";
    case "PERSONAL_CARE":
      return "personal";
    case "GENERAL_SERVICES":
      return d === "GENERAL_SERVICES_INSURANCE" ? "insurance" : "other";
    case "GOVERNMENT_AND_NON_PROFIT":
      return d === "GOVERNMENT_AND_NON_PROFIT_DONATIONS" ? "giving" : "other";
    case "TRANSPORTATION":
      return "transport";
    case "TRAVEL":
      return "travel";
    case "RENT_AND_UTILITIES":
      return d === "RENT_AND_UTILITIES_RENT" ? "housing" : "utilities";
    default:
      return "other";
  }
}
