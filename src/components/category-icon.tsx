import { category } from "@/lib/categories";
import { PixelIcon, isPixelName } from "./pixel-icons";
import { cx } from "./ui";

/** A category's pixel icon on a small tile. Income sits on mint (money coming in); the rest on plain. */
export function CategoryIcon({ category: key, size = "md" }: { category: string; size?: "md" | "sm" }) {
  const k = category(key).key;
  return (
    <span aria-hidden className={cx("inline-flex shrink-0 items-center justify-center rounded-[8px] border-2", size === "md" ? "size-9" : "size-7", key === "income" ? "border-mint-ink/40 bg-mint text-mint-ink" : "border-line bg-sunk text-ink-2")}>
      <PixelIcon name={isPixelName(k) ? k : "other"} size={size === "md" ? 18 : 14} />
    </span>
  );
}
