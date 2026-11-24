"use client";

import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { CategoryEditor } from "@/components/categories";
import { CategoryIcon } from "@/components/category-icon";
import { Button, Dialog, EmptyState, ErrorNote, PageHeader, Sheet, SheetHeader, Skeleton, toast } from "@/components/ui";
import { send, useApi } from "@/components/use-api";
import { BUDGET_CATEGORIES, type UserCategory } from "@/lib/categories";

type Removed = { category: UserCategory; transactionIds: string[]; rules: string[]; budget: unknown };

/** Categories of your own ("Car", "Tools"): make one, rename it, change its icon, or remove it (with Undo). */
export default function CategoriesPage() {
  const { data, error, mutate } = useApi<{ categories: UserCategory[] }>("/api/categories");
  const [editing, setEditing] = useState<UserCategory | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (c: UserCategory) => {
    setBusy(true);
    try {
      const { undo } = await send<{ undo: Removed }>("DELETE", `/api/categories/${c.key}`);
      setEditing(null);
      const moved = undo.transactionIds.length;
      toast(`Removed ${c.label}${moved ? `: ${moved} ${moved === 1 ? "charge" : "charges"} back in Everything else` : ""}`, { action: { label: "Undo", run: () => send("POST", "/api/categories/restore", undo) } });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t remove it. Try again.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Categories"
        back={{ href: "/you", label: "You" }}
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> New
          </Button>
        }
      />
      {error && !data ? (
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      ) : !data ? (
        <Skeleton className="h-48 rounded-sheet" />
      ) : (
        <div className="grid max-w-2xl grid-cols-1 gap-4">
          <Sheet>
            <SheetHeader title="Your own" hint="Everyday spending you sort yourself. Each can have a budget, and stores you remember for it land there on their own." />
            {data.categories.length === 0 ? (
              <EmptyState title="None yet">Make one for what doesn’t fit, like “Car” for auto parts or “Tools”. You can also make one straight from a transaction’s category list.</EmptyState>
            ) : (
              <ul>
                {data.categories.map((c) => (
                  <li key={c.key}>
                    <button type="button" onClick={() => setEditing(c)} className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-sunk active:bg-sunk">
                      <CategoryIcon category={c.key} />
                      <span className="min-w-0 flex-1 truncate font-bold">{c.label}</span>
                      <ChevronRight size={16} className="shrink-0 text-ink-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
          <Sheet>
            <SheetHeader title="Built in" hint="Always there. Bills (rent, utilities, insurance, loans) are set aside first and never budgeted." />
            <ul className="flex flex-wrap gap-2">
              {BUDGET_CATEGORIES.map((c) => (
                <li key={c.key} className="flex items-center gap-2 rounded-full border border-line-soft py-1 pl-1 pr-3 text-small font-bold">
                  <CategoryIcon category={c.key} size="sm" />
                  {c.label}
                </li>
              ))}
            </ul>
          </Sheet>
        </div>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New category" : editing ? editing.label : ""}>
        {editing !== null && (
          <div className="flex flex-col gap-4">
            <CategoryEditor key={editing === "new" ? "new" : editing.key} initial={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onDone={() => setEditing(null)} />
            {editing !== "new" && (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => remove(editing)} className="self-start">
                Remove {editing.label}
              </Button>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
