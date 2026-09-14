import type { ReactNode } from 'react';

export function Chip({ tone = 'info', children }: { tone?: string; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Card({ title, extra, children, className = '' }: {
  title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && <header className="card-head"><h3>{title}</h3><div className="card-extra">{extra}</div></header>}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Loading() {
  return <div className="loading">加载中…</div>;
}

export function Empty({ text = '暂无数据' }: { text?: string }) {
  return <div className="empty">{text}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error-box">⚠ {error instanceof Error ? error.message : String(error)}</div>;
}

export function OkBox({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="ok-box">✓ {text}</div>;
}
