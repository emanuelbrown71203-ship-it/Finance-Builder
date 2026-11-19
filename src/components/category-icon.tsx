import { ArrowLeftRight, Banknote, Car, Coffee, Gift, HeartPulse, House, Landmark, Plane, Receipt, Scissors, Shapes, ShieldCheck, ShoppingBag, ShoppingBasket, Ticket, Zap, type LucideIcon } from "lucide-react";
import { category } from "@/lib/categories";
import { cx } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  income: Banknote,
  housing: House,
  utilities: Zap,
  groceries: ShoppingBasket,
  dining: Coffee,
  transport: Car,
  shopping: ShoppingBag,
  entertainment: Ticket,
  health: HeartPulse,
  personal: Scissors,
  travel: Plane,
  insurance: ShieldCheck,
  loans: Landmark,
  giving: Gift,
  fees: Receipt,
  other: Shapes,
  transfer: ArrowLeftRight,
};

/** Income sits on mint, everything else on plain paper: color marks direction, the glyph marks the category. */
export function CategoryIcon({ category: key, size = "md" }: { category: string; size?: "md" | "sm" }) {
  const Icon = ICONS[category(key).key] ?? Shapes;
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center rounded-full", size === "md" ? "size-9" : "size-7", key === "income" ? "bg-mint text-mint-ink" : "bg-sunk text-ink-2")}>
      <Icon size={size === "md" ? 17 : 14} strokeWidth={1.9} />
    </span>
  );
}
