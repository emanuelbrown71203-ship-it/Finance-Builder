"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- surfaces ---------- */

export function Sheet({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx("min-w-0 rounded-sheet border border-line-soft bg-sheet p-5 sm:p-6", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SheetHeader({ title, action, hint }: { title: string; action?: ReactNode; hint?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="display text-lead">{title}</h2>
        {hint && <p className="mt-1 text-small text-ink-3">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

export function PageHeader({ title, lead, action }: { title: string; lead?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="max-w-[60ch]">
        <h1 className="display text-headline">{title}</h1>
        {lead && <p className="mt-2 text-ink-2">{lead}</p>}
      </div>
      {action}
    </header>
  );
}

/* ---------- controls ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "ghost" | "danger"; size?: "md" | "sm" };

export function Button({ variant = "quiet", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-10 px-4 text-body" : "h-8 px-3 text-small",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-strong",
        variant === "quiet" && "border border-line bg-sheet text-ink hover:bg-sunk",
        variant === "ghost" && "text-accent-text hover:bg-sunk",
        variant === "danger" && "border border-line bg-sheet text-bad hover:bg-sunk",
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-sunk hover:text-ink", className)} {...rest}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-control border border-line bg-sunk p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-8 rounded-[8px] px-3 text-small font-medium transition-colors", value === o.value ? "bg-sheet text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-3 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const fieldClass = "h-10 w-full rounded-control border border-line bg-sheet px-3 text-body text-ink placeholder:text-ink-3 focus:border-accent-text focus:outline-none focus:ring-2 focus:ring-sky";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-small font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1.5 text-small text-bad">{error}</p> : hint ? <p className="mt-1.5 text-small text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldClass, className)} {...rest} />;
}

export function MoneyInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
      <input inputMode="decimal" className={cx(fieldClass, "tabular pl-7", className)} {...rest} />
    </div>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldClass, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%228%22 fill=%22none%22 stroke=%22%235f6b88%22 stroke-width=%222%22><path d=%22m1 1 5 5 5-5%22/></svg>')] bg-[position:right_0.8rem_center] bg-no-repeat pr-9", className)} {...rest}>
      {children}
    </select>
  );
}

/* ---------- small pieces ---------- */

const TONES = {
  mint: "bg-mint text-mint-ink",
  pink: "bg-pink text-pink-ink",
  canary: "bg-canary text-canary-ink",
  sky: "bg-sky text-sky-ink",
  plain: "bg-sunk text-ink-2",
} as const;
export type Tone = keyof typeof TONES;

export function Tag({ tone = "plain", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-medium", TONES[tone], className)}>{children}</span>;
}

/**
 * A ratio against a limit. The fill says how you’re doing: blue while there’s
 * room, amber when nearly used up, red once over. Always paired with figures.
 */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? value / max : 0;
  const color = ratio > 1 ? "var(--bad)" : ratio >= 0.9 ? "var(--warn)" : "var(--accent)";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className="h-2 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, var(--sheet))` }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(ratio > 0 ? 2 : 0, ratio * 100))}%`, background: color }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-control bg-line-soft", className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-control border border-dashed border-line px-5 py-6">
      <div>
        <p className="font-medium">{title}</p>
        {children && <p className="mt-1 max-w-[52ch] text-small text-ink-2">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-pink px-4 py-3 text-small text-pink-ink">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

/* ---------- dialog ---------- */

export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-sheet border border-line bg-sheet p-0 text-ink shadow-[0_24px_60px_-20px_rgb(22_36_77/0.45)] max-sm:mb-4"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="display text-title">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
              <X size={18} />
            </IconButton>
          </div>
          {children}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
