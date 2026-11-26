import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

let openModalCount = 0;

export function Modal({
  title,
  onClose,
  headerExtra,
  footer,
  disableEsc = false,
  children,
}: {
  title: string;
  onClose: () => void;
  headerExtra?: ReactNode;
  footer?: ReactNode;
  disableEsc?: boolean;
  children: ReactNode;
}) {
  const mouseDownOnBackdrop = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    openModalCount++;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, []);

  useEffect(() => {
    if (disableEsc) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, disableEsc]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    if (dialog && !dialog.contains(previous)) {
      const first = dialog.querySelector<HTMLElement>('[data-initial-focus]') ?? dialog;
      first.focus({ preventScroll: true });
    }
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && !dialog?.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="modal-back"
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const scope = event.currentTarget.querySelector('[role="alertdialog"]') ?? event.currentTarget;
        const items = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')]
          .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const focused = document.activeElement;
        const boundary = event.shiftKey ? items.at(-1) : items[0];
        if (!items.includes(focused as HTMLElement) || focused === (event.shiftKey ? items[0] : items.at(-1))) {
          event.preventDefault();
          boundary?.focus();
        }
      }}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) {
          onClose();
        }
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <div className="row" style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {headerExtra}
          </div>
          <button type="button" className="btn icon-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer-bar">{footer}</div>}
      </div>
    </div>
  );
}

export function Pills<T extends string>({
  options,
  value,
  onChange,
  multi,
  bad,
}: {
  options: Array<[T, string]>;
  value: T | T[] | null;
  onChange: (v: any) => void;
  multi?: boolean;
  bad?: T[];
}) {
  const isOn = (o: T) => (multi ? (value as T[]).includes(o) : value === o);
  return (
    <div className="row">
      {options.map(([o, label]) => (
        <button
          key={o}
          type="button"
          className={`pill ${isOn(o) ? 'on' : ''} ${bad?.includes(o) ? 'bad' : ''}`}
          aria-pressed={isOn(o)}
          onClick={() => onChange(multi ? (isOn(o) ? (value as T[]).filter((x) => x !== o) : [...(value as T[]), o]) : o)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
