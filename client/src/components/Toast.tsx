import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastInput {
  type: ToastType;
  title: string;
  detail?: string;
}

interface ToastItem extends ToastInput {
  id: string;
}

const ToastContext = createContext<{ toast: (input: ToastInput) => void } | null>(null);

const ICONS = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev.slice(-3), { ...input, id }]);
      window.setTimeout(() => dismiss(id), 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const Icon = ICONS[item.type];
          return (
            <div key={item.id} className={`toast ${item.type}`} role="status">
              <Icon size={18} className="toast-icon" aria-hidden />
              <div className="toast-body">
                <div className="toast-title">{item.title}</div>
                {item.detail && <div className="toast-detail">{item.detail}</div>}
              </div>
              <button type="button" className="toast-close" onClick={() => dismiss(item.id)} aria-label="关闭通知">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { toast: () => undefined };
  }
  return ctx;
}
