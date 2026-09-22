import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const controlClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink shadow-sm transition placeholder:text-muted focus:border-primary disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted';

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-white hover:bg-blue-700',
    secondary: 'bg-secondary text-white hover:bg-teal-800',
    ghost: 'bg-surface text-ink border border-line hover:bg-canvas',
    danger: 'bg-danger text-white hover:bg-red-700',
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${controlClass} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${controlClass} min-h-28 ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${controlClass} ${props.className ?? ''}`} />;
}

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}{required ? ' *' : ''}
      <div className="mt-1.5">{children}</div>
      {hint ? <span className="mt-1 block text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition ${checked ? 'bg-primary' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${checked ? 'end-0.5' : 'start-0.5'}`} />
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}>{children}</section>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  const styles = {
    neutral: 'bg-slate-100 text-slate-700',
    success: 'bg-green-50 text-success',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-danger',
    info: 'bg-blue-50 text-primary',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${styles}`}>{children}</span>;
}

export function Alert({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' | 'warning' }) {
  const styles = {
    info: 'border-blue-100 bg-blue-50 text-blue-900',
    danger: 'border-red-100 bg-red-50 text-red-900',
    warning: 'border-amber-100 bg-amber-50 text-amber-900',
  }[tone];
  return <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 text-sm text-muted">{body}</p> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200 ${className}`} />;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-card sm:max-w-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-canvas" aria-label="close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
