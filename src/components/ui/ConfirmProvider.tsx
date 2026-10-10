import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ModalFooter } from './index';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((input: ConfirmOptions | string) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(typeof input === 'string' ? { message: input } : input);
      setOpen(true);
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpen(false);
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, open]);

  const variant = options?.variant ?? 'primary';
  const title = options?.title ?? t('confirmTitle');
  const confirmLabel = options?.confirmLabel ?? t('confirmOk');
  const cancelLabel = options?.cancelLabel ?? t('cancel');

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {open && options ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-overlay p-0 sm:items-center sm:p-6"
          role="presentation"
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            className="w-full rounded-t-2xl bg-surface p-5 shadow-card sm:max-w-md sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-ink">
              {title}
            </h2>
            <p id="confirm-dialog-message" className="mt-2 text-sm text-muted">
              {options.message}
            </p>
            <ModalFooter className="justify-end sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                {cancelLabel}
              </Button>
              <Button
                type="button"
                variant={variant === 'danger' ? 'danger' : 'primary'}
                onClick={() => close(true)}
              >
                {confirmLabel}
              </Button>
            </ModalFooter>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return context.confirm;
}
