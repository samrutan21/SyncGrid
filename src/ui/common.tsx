import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { statusTone } from '../core/config/defaults';

/** Inline style with CSS custom properties (e.g. --c for a category color). */
export const cssVars = (vars: Record<string, string>): CSSProperties => vars as CSSProperties;

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, no icon font / CDN)                              */
/* ------------------------------------------------------------------ */

const paths: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  prev: 'M6 5h2v14H6zM9.5 12 18 5v14z',
  next: 'M16 5h2v14h-2zM14.5 12 6 19V5z',
  stepBack: 'M14 6 8 12l6 6',
  stepFwd: 'M10 6l6 6-6 6',
  upload: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.4-1.4L14.2 2h-4l-.4 2.7a7 7 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.4 1.4l.4 2.7h4l.4-2.7a7 7 0 0 0 2.4-1.4l2.4 1 2-3.4z',
  columns: 'M4 5h16v14H4zM9.5 5v14M14.5 5v14',
  table: 'M4 5h16v14H4zM4 10h16M4 14.5h16M10 10v9',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  camera: 'M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  warn: 'M12 4 2.5 20h19zM12 10v4.5M12 17v.5',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  merge: 'M7 4v5a4 4 0 0 0 4 4h6M17 9v8M7 20v-3',
  split: 'M12 4v16M5 8l-3 4 3 4M19 8l3 4-3 4',
  chevDown: 'M6 9l6 6 6-6',
  chevRight: 'M9 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  folder: 'M3 6h6l2 2h10v11H3z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  check: 'M5 12.5l4.5 4.5L19 7',
  back: 'M15 6l-6 6 6 6',
};

export function Icon({ name, size = 16, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  const filled = name === 'play' || name === 'pause' || name === 'prev' || name === 'next';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons, modal, drop zones                                          */
/* ------------------------------------------------------------------ */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger';
  icon?: string;
  small?: boolean;
};
export function Button({ variant = 'subtle', icon, small, children, className = '', ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant} ${small ? 'btn-sm' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={small ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function DropZone({
  accept,
  onFiles,
  children,
  className = '',
  multiple,
}: {
  accept: string;
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  multiple?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''} ${className}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

export function StatusPill({ value }: { value: string }) {
  if (!value) return null;
  return <span className={`pill pill-${statusTone(value)}`}>{value}</span>;
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}

/** Safe external link: only http(s) and mailto open; everything else is shown as text. */
export function safeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : /^www\.|^[\w-]+\.[a-z]{2,}(\/|$)/i.test(v) ? `https://${v}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Text input that commits on blur / Enter, so typing doesn't save on every key. */
export function CommitInput({
  value,
  onCommit,
  multiline,
  placeholder,
  className,
  list,
  type = 'text',
  autoFocus,
}: {
  value: string;
  onCommit: (v: string) => void | false;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  list?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v === value) return;
    if (onCommit(v) === false) setV(value);
  };
  if (multiline) {
    return (
      <textarea
        className={`input ${className ?? ''}`}
        value={v}
        placeholder={placeholder}
        rows={Math.min(8, Math.max(2, v.split('\n').length))}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
          if (e.key === 'Escape') {
            setV(value);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    );
  }
  return (
    <input
      className={`input ${className ?? ''}`}
      value={v}
      type={type}
      list={list}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function PromptModal({
  title,
  label,
  initial = '',
  confirm = 'Save',
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirm?: string;
  onSubmit: (v: string) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSubmit(v);
              onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <label className="field">
        <span>{label}</span>
        <input
          className="input"
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSubmit(v);
              onClose();
            }
          }}
        />
      </label>
    </Modal>
  );
}
