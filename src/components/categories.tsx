"use client";

import { useState } from "react";
import { CATEGORY_ICONS, type UserCategory } from "@/lib/categories";
import { PixelIcon, isPixelName } from "./pixel-icons";
import { Button, ErrorNote, Field, Input, cx, toast } from "./ui";
import { send } from "./use-api";

/**
 * Making a category of your own ("Car", "Tools"), or changing one: a name and a pixel icon. It's
 * everyday spending, so it can have a budget and every store remembered for it lands there.
 */
export function CategoryEditor({ initial, onDone, onCancel, inside }: { initial?: UserCategory; onDone: (category: UserCategory) => void; onCancel?: () => void; /** Inside another form: no form of its own (forms can't nest). */ inside?: boolean }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!label.trim()) return setError("Give it a name, like “Car”.");
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        const { previous } = await send<{ previous: UserCategory }>("PATCH", `/api/categories/${initial.key}`, { label, icon });
        toast(`Saved ${label.trim()}`, { action: { label: "Undo", run: () => send("PATCH", `/api/categories/${initial.key}`, { label: previous.label, icon: previous.icon }) } });
        onDone({ ...initial, label: label.trim(), icon });
      } else {
        const { category } = await send<{ category: UserCategory }>("POST", "/api/categories", { label, icon });
        toast(`Made ${category.label}`);
        onDone(category);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save. Try again.");
      setBusy(false);
    }
  };

  const Box = inside ? "div" : "form";
  return (
    <Box onSubmit={inside ? undefined : save} className="flex flex-col gap-4">
      <Field label="Name">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} autoCapitalize="words" placeholder="Car" enterKeyHint="done" onKeyDown={(e) => inside && e.key === "Enter" && (e.preventDefault(), void save())} />}</Field>
      <div>
        <p className="mb-1.5 text-small font-bold text-ink-2">Icon</p>
        <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Icon">
          {CATEGORY_ICONS.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={icon === name}
              aria-label={name}
              onClick={() => setIcon(name)}
              className={cx("flex aspect-square items-center justify-center rounded-xl border-2 active:scale-[0.96]", icon === name ? "border-accent bg-accent-soft text-accent-text" : "border-line-soft bg-sheet text-ink-2")}
            >
              <PixelIcon name={isPixelName(name) ? name : "other"} size={20} />
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" type={inside ? "button" : "submit"} disabled={busy} onClick={inside ? () => void save() : undefined}>
          {initial ? "Save" : "Make it"}
        </Button>
      </div>
    </Box>
  );
}
