import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastState {
  message: string;
  undo?: (() => void) | undefined;
}

type Notify = (message: string, undo?: () => void) => void;

const ToastContext = createContext<Notify>(() => undefined);
export const useNotify = (): Notify => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = useCallback<Notify>((message, undo) => {
    setToast({ message, undo });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setToast(null);
    }, 10_000);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext value={notify}>
      {children}
      {toast && (
        <div
          role="status"
          data-testid="toast"
          className="fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg sm:inset-x-auto sm:left-4"
        >
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </ToastContext>
  );
}
