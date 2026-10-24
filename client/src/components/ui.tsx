import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertOctagon, AlertTriangle, ArrowRightLeft, BadgeCheck, CalendarClock, CheckCircle2, CircleDashed, Clock, FileQuestion, Inbox, Info, Landmark, Loader2, LoaderCircle,
  MessageSquareWarning, RefreshCw, Search, ShieldCheck, UserCheck, X, XCircle,
} from 'lucide-react';
import { BANK_STATUS, STATUS_COLOR, VALIDITY } from '../lib/colors';
import type { Severity, Status, Validity, Verification } from '../lib/types';

export function Card({ title, subtitle, actions, children, className, bodyClass, id }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section id={id} className={clsx('glass rounded-[24px]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-6 pb-2 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[16px] text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-6', (title || actions) && 'pt-3', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: Array<{ label: string; to?: string }> }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && (
          <nav className="eyebrow mb-2 flex flex-wrap items-center gap-1.5 text-ink-3">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                {c.to ? <Link to={c.to} className="hover:text-accent-text hover:underline">{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[28px] leading-tight text-ink sm:text-[36px]">{title}</h1>
        {subtitle && <p className={clsx('mt-1.5 text-ink-3', typeof subtitle === 'string' && subtitle.length <= 48 ? 'eyebrow' : 'text-sm')}>{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', className, loading, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3.5 text-[12px]' : 'h-11 px-5 text-[13px]',
        variant === 'primary' && 'btn-raised hover:brightness-105',
        variant === 'secondary' && 'bg-surface-2 text-ink hover:bg-surface-3',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'bg-critical text-white shadow-[0_10px_26px_-10px_var(--critical)] hover:brightness-110',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className, required }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink-3">{label}{required && <span className="text-critical-text"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}
const ctlBase = 'rounded-2xl border border-transparent bg-surface-2 px-3.5 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-accent/70 focus:outline-none disabled:opacity-60';
// Full width unless the caller sets its own width.
const ctl = (className?: string) => clsx(ctlBase, !/(^|\s)(w-|min-w-)/.test(className ?? '') && 'w-full', className);
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(ctl(className), 'h-11')} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(ctl(className), 'py-2.5')} />;
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(ctl(className), 'h-11 pr-8')}>{children}</select>;

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3"><LoaderCircle className="size-5 animate-spin" />{label}</div>;
}
export function Empty({ icon, title, body }: { icon?: ReactNode; title: string; body?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-2 text-muted">{icon ?? <CircleDashed className="size-8" />}</div>
      <p className="font-medium text-ink-2">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-ink-3">{body}</p>}
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-xl border border-critical/30 bg-critical-soft px-3.5 py-2.5 text-sm text-critical-text">{(error as Error).message || String(error)}</div>;
}

// ---------- badges ----------
type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'muted';
const TONE: Record<Tone, string> = {
  good: 'bg-good-soft text-good-text', warning: 'bg-warning-soft text-warning-text', serious: 'bg-serious-soft text-serious-text',
  critical: 'bg-critical-soft text-critical-text', info: 'bg-info-soft text-info-text', muted: 'bg-surface-2 text-ink-3',
};
export function ToneBadge({ tone, children, icon, title }: { tone: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  return <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONE[tone])}>{icon}{children}</span>;
}

const STATUS_ICON: Record<string, ReactNode> = {
  Submitted: <Inbox className="size-3.5" />, 'Under Scrutiny': <Search className="size-3.5" />, 'Query Raised': <MessageSquareWarning className="size-3.5" />,
  Active: <ShieldCheck className="size-3.5" />, Matured: <CalendarClock className="size-3.5" />, Renewed: <RefreshCw className="size-3.5" />,
  'Release Requested': <ArrowRightLeft className="size-3.5" />, Released: <CheckCircle2 className="size-3.5" />, Rejected: <XCircle className="size-3.5" />,
};
export function StatusBadge({ status }: { status: Status | string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2">
      <span style={{ color: STATUS_COLOR[status] }}>{STATUS_ICON[status]}</span>
      {status}
    </span>
  );
}

export function ValidityBadge({ state, daysLeft }: { state?: Validity | string; daysLeft?: number | null }) {
  if (!state || state === 'closed') return null;
  const m = VALIDITY[state] ?? { label: state, tone: 'muted' as Tone };
  const extra = daysLeft === null || daysLeft === undefined ? '' : state === 'lapsed' ? ` · ${-daysLeft}d` : state === 'expiring' || state === 'maturing' ? ` · ${daysLeft}d` : '';
  const icon = state === 'lapsed' ? <AlertTriangle className="size-3.5" /> : state === 'expiring' ? <Clock className="size-3.5" /> : state === 'valid' ? <CheckCircle2 className="size-3.5" /> : null;
  return <ToneBadge tone={m.tone} icon={icon}>{m.label}{extra}</ToneBadge>;
}

export function BankBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const m = BANK_STATUS[status] ?? { label: status, tone: 'muted' as Tone };
  return <ToneBadge tone={m.tone} icon={<Landmark className="size-3.5" />}>{m.label}</ToneBadge>;
}

/** How an instrument was verified: bank-confirmed vs institution-declared is the key distinction. */
export function VerificationBadge({ mode }: { mode: Verification | string }) {
  if (mode === 'bank_api') return <ToneBadge tone="good" icon={<BadgeCheck className="size-3.5" />} title="Confirmed directly by the bank's verification service">Bank-confirmed (online)</ToneBadge>;
  if (mode === 'bank_letter') return <ToneBadge tone="good" icon={<BadgeCheck className="size-3.5" />} title="Confirmed by a letter from the bank">Bank-confirmed (letter)</ToneBadge>;
  if (mode === 'officer') return <ToneBadge tone="warning" icon={<UserCheck className="size-3.5" />} title="Accepted by an officer without bank confirmation">Officer-verified</ToneBadge>;
  return <ToneBadge tone="muted" icon={<FileQuestion className="size-3.5" />} title="Only the institution's declaration so far">Institution-declared</ToneBadge>;
}

export function IssueDot({ worst, count }: { worst?: number | null; count?: number }) {
  if (!count) return null;
  const tone: Tone = worst === 4 ? 'critical' : worst === 3 ? 'serious' : worst === 2 ? 'warning' : 'info';
  return <ToneBadge tone={tone} icon={<AlertTriangle className="size-3.5" />} title={`${count} open discrepanc${count === 1 ? 'y' : 'ies'}`}>{count}</ToneBadge>;
}

const SEV: Record<Severity, { cls: string; icon: ReactNode; label: string }> = {
  info: { cls: 'bg-info-soft text-info-text', icon: <Info className="size-3.5" />, label: 'Info' },
  warning: { cls: 'bg-warning-soft text-warning-text', icon: <Clock className="size-3.5" />, label: 'Warning' },
  serious: { cls: 'bg-serious-soft text-serious-text', icon: <AlertTriangle className="size-3.5" />, label: 'Serious' },
  critical: { cls: 'bg-critical-soft text-critical-text', icon: <AlertOctagon className="size-3.5" />, label: 'Critical' },
};
export function SeverityBadge({ severity, label }: { severity: Severity; label?: string }) {
  const m = SEV[severity];
  return <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', m.cls)}>{m.icon}{label ?? m.label}</span>;
}
export const severityIcon = (s: Severity) => SEV[s].icon;

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2', className)}>{children}</span>;
}

// ---------- tabs ----------
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ value: T; label: ReactNode; count?: number }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-print mb-5 max-w-full overflow-x-auto">
      <div className="inline-flex gap-1 rounded-full bg-panel p-1.5" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={clsx('flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-all',
            value === t.value ? 'bg-accent text-accent-ink' : 'text-ink-3 hover:text-ink')}>
          {t.label}
          {t.count !== undefined && <span className={clsx('rounded-full px-1.5 text-[11px] tnum', value === t.value ? 'bg-black/15' : 'bg-surface-2 text-ink-2')}>{t.count}</span>}
        </button>
      ))}
      </div>
    </div>
  );
}

// ---------- modal ----------
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal className={clsx('glass-pop max-h-[92vh] w-full overflow-auto rounded-t-[24px] sm:rounded-[24px]', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-[var(--popover)] px-6 pb-2 pt-5">
          <h3 className="text-base">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink-3 hover:bg-surface-2" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="px-6 py-3">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 bg-[var(--popover)] px-6 pb-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

export function KeyVal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-ink-3">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children ?? '—'}</dd>
    </div>
  );
}

export function ScoreBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100);
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)} title={`${pct}% match`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs tnum text-ink-2">{pct}%</span>
    </span>
  );
}
