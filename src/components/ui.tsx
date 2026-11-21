"use client";

import Link from "next/link";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type PointerEvent, type ReactNode, type SelectHTMLAttributes } from "react";

/*
  Shared building blocks. They follow docs/house-style.md: phone first, tap
  targets of at least 44px, pop-ups that slide up from the bottom on a phone,
  and Undo instead of "are you sure?" for everyday changes.
*/

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- surfaces ---------- */

export function Sheet({ children, className, as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx("min-w-0 rounded-sheet border border-line-soft bg-sheet p-4 shadow-card sm:p-6", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SheetHeader({ title, action, hint }: { title: string; action?: ReactNode; hint?: ReactNode }) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 className="display text-lead">{title}</h2>
        {hint && <p className="mt-1 text-small text-ink-3">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

/**
 * The top of every screen: a big title that stays pinned while you scroll on
 * a phone, with one action on the right and an optional line saying what the
 * screen is for.
 */
export function PageHeader({ title, lead, action, back }: { title: string; lead?: ReactNode; action?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 flex min-h-[60px] items-center justify-between gap-3 bg-paper/90 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur-xl sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:backdrop-blur-none">
        <div className="flex min-w-0 items-center gap-1">
          {back && (
            <Link href={back.href} aria-label={`Back to ${back.label}`} className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 active:scale-[0.96] active:bg-sunk">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
          )}
          {/* Screens reached with Back often have a long name (a goal); they wrap to two lines instead of cutting off. */}
          <h1 className={cx("display min-w-0 text-[1.625rem] lg:text-headline", back ? "line-clamp-2 break-words leading-tight" : "truncate")}>{title}</h1>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {lead ? <p className="mb-5 mt-1 max-w-[60ch] text-ink-2">{lead}</p> : <div className="mb-3" />}
    </>
  );
}

/* ---------- controls ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "ghost" | "danger" | "destructive"; size?: "md" | "sm" };

export function Button({ variant = "quiet", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-bold transition-[background-color,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "min-h-12 px-5 text-body" : "min-h-10 px-3.5 text-small",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-strong",
        variant === "quiet" && "border border-line bg-sheet text-ink hover:bg-sunk",
        variant === "ghost" && "text-accent-text hover:bg-sunk",
        variant === "danger" && "border border-line bg-sheet text-bad hover:bg-sunk",
        // The final "yes, delete it" button in a confirmation.
        variant === "destructive" && "bg-bad text-sheet",
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx("inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-sunk text-ink-2 transition-colors hover:text-ink active:scale-95 disabled:opacity-40", className)} {...rest}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, full }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; full?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("rounded-control bg-sunk p-1", full ? "flex w-full" : "inline-flex")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("min-h-10 rounded-[10px] px-3.5 text-small font-bold transition-colors", full && "flex-1", value === o.value ? "bg-sheet text-ink shadow-card" : "text-ink-3 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const fieldClass = "min-h-12 w-full rounded-control border border-line bg-sheet px-3.5 text-body text-ink placeholder:text-ink-3 focus:border-accent-text focus:outline-none focus:ring-4 focus:ring-accent-soft";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-small font-bold text-ink-2">
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
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-ink-3">$</span>
      <input inputMode="decimal" enterKeyHint="done" className={cx(fieldClass, "tabular pl-8", className)} {...rest} />
    </div>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldClass, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%228%22 fill=%22none%22 stroke=%22%235d6781%22 stroke-width=%222%22><path d=%22m1 1 5 5 5-5%22/></svg>')] bg-[position:right_0.9rem_center] bg-no-repeat pr-9", className)} {...rest}>
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
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-micro font-bold", TONES[tone], className)}>{children}</span>;
}

/**
 * A ratio against a limit. The fill says how you're doing: green while there's
 * room, amber when nearly used up, red once over. Always paired with figures.
 */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? value / max : 0;
  const color = ratio > 1 ? "var(--bad)" : ratio >= 0.9 ? "var(--warn)" : "var(--accent)";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, var(--sheet))` }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(ratio > 0 ? 2 : 0, ratio * 100))}%`, background: color }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-control bg-line-soft", className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-control border-2 border-dashed border-line bg-sunk px-5 py-6">
      <div>
        <p className="font-bold">{title}</p>
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
        <button type="button" onClick={onRetry} className="min-h-10 font-bold underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

/** Detail that isn't needed every time: closed, with a one-line summary, until tapped. */
export function Fold({ title, summary, children, defaultOpen = false, className }: { title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-h-12 w-full items-center justify-between gap-3 text-left">
        <span className="font-bold">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-small opacity-80">
          {!open && summary && <span className="tabular truncate">{summary}</span>}
          <ChevronDown size={18} className={cx("shrink-0 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div id={id}>{children}</div>}
    </div>
  );
}

/* ---------- pop-ups ---------- */

/**
 * A pop-up. On a phone it is a sheet that slides up from the bottom, with a
 * handle you can drag down to close; on a bigger screen it is a centred card.
 * Tapping outside or pressing Escape closes it, and it stays above the keyboard.
 */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ startY: number; dy: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Keep the sheet above the on-screen keyboard.
  useEffect(() => {
    const el = ref.current;
    const viewport = window.visualViewport;
    if (!open || !el || !viewport) return;
    const update = () => {
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      el.style.setProperty("--keyboard", covered > 80 ? `${covered}px` : "0px");
      el.style.setProperty("--sheet-max", `${viewport.height - 8}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);

  const onHandleDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!drag.current || !el) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY);
    el.style.transition = "none";
    el.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onHandleUp = () => {
    const el = ref.current;
    const moved = drag.current?.dy ?? 0;
    drag.current = null;
    if (!el) return;
    el.style.transition = "transform 0.2s ease";
    el.style.transform = "";
    if (moved > 100) onClose();
  };

  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} className="sheet">
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <div onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp} className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 sm:hidden" aria-hidden>
            <span className="h-1.5 w-10 rounded-full bg-line" />
          </div>
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-2 sm:px-6 sm:pt-6">
            <h2 className="display text-title">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mr-1.5 -mt-1 size-10">
              <X size={18} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] sm:px-6 sm:pb-6">
            {children}
            {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
          </div>
        </div>
      )}
    </dialog>
  );
}

/* ---------- messages with Undo ---------- */

type ToastItem = { id: number; message: string; tone: "ok" | "error"; action?: { label: string; run: () => void | Promise<unknown> } };

let toasts: ToastItem[] = [];
let nextToastId = 1;
const toastListeners = new Set<() => void>();
const NO_TOASTS: ToastItem[] = [];
const emitToasts = () => toastListeners.forEach((l) => l());

function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

/**
 * A short message above the tab bar. Give it an action ("Undo") for anything
 * the person might want to take back: it then stays a little longer.
 */
export function toast(message: string, options: { tone?: "ok" | "error"; action?: ToastItem["action"] } = {}) {
  const item: ToastItem = { id: nextToastId++, message, tone: options.tone ?? "ok", action: options.action };
  toasts = [...toasts.slice(-2), item];
  emitToasts();
  setTimeout(() => dismissToast(item.id), item.action ? 7000 : item.tone === "error" ? 6000 : 4000);
}

export function Toaster() {
  const list = useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener);
      return () => toastListeners.delete(listener);
    },
    () => toasts,
    () => NO_TOASTS,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-3 lg:bottom-6">
      {list.map((t) => (
        <div key={t.id} role="status" className={cx("toast pointer-events-auto flex w-full max-w-[440px] items-center justify-between gap-4 rounded-control px-4 py-3 text-small font-semibold shadow-float", t.tone === "error" ? "bg-bad text-sheet" : "bg-ink text-sheet")}>
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="-my-2 min-h-11 shrink-0 font-extrabold underline underline-offset-2"
              onClick={() => {
                dismissToast(t.id);
                // If Undo can't be done (say the money was already taken out), say so rather than failing quietly.
                Promise.resolve()
                  .then(() => t.action!.run())
                  .catch((e: unknown) => toast(e instanceof Error ? e.message : "Couldn’t undo that. Try again.", { tone: "error" }));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- "are you sure?", only for things that can't be undone ---------- */

type ConfirmOptions = { title: string; body?: string; confirmLabel: string; danger?: boolean };
let pendingConfirm: { options: ConfirmOptions; resolve: (ok: boolean) => void } | null = null;
const confirmListeners = new Set<() => void>();
const emitConfirm = () => confirmListeners.forEach((l) => l());

/** Asks before something permanent. Resolves true when the person goes ahead. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirm?.resolve(false);
    pendingConfirm = { options, resolve };
    emitConfirm();
  });
}

export function ConfirmHost() {
  const current = useSyncExternalStore(
    (listener) => {
      confirmListeners.add(listener);
      return () => confirmListeners.delete(listener);
    },
    () => pendingConfirm,
    () => null,
  );
  const answer = (ok: boolean) => {
    pendingConfirm?.resolve(ok);
    pendingConfirm = null;
    emitConfirm();
  };
  return (
    <Dialog open={current !== null} onClose={() => answer(false)} title={current?.options.title ?? ""}>
      {current && (
        <>
          <p className="text-ink-2">{current.options.body ?? "This can’t be undone."}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button className="flex-1" onClick={() => answer(false)}>
              Cancel
            </Button>
            <Button className="flex-1" variant={current.options.danger ? "destructive" : "primary"} onClick={() => answer(true)} autoFocus>
              {current.options.confirmLabel}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
