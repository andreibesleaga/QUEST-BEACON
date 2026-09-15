'use client';
// BEACON — Dialog primitive (E8·T-345a; UIUX §3). Thin token-styled wrapper over @radix-ui/react-dialog:
// focus trap, ESC/overlay close, `aria-modal` + labelled title, scroll-lock — all correct for free.
import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementRef, ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../_lib/cn.js';
import { useT } from '../../_lib/i18n.js';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content>;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent({ className, children, ...rest }, ref): ReactNode {
  const t = useT('ui');
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2',
          'flex-col gap-4 overflow-auto rounded-lg border border-line bg-surface p-6 text-fg shadow-lg',
          className,
        )}
        {...rest}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={t('dialog.close')}
          className="absolute right-3 top-3 inline-flex size-11 items-center justify-center rounded-lg text-fg-muted transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-fg"
        >
          <X aria-hidden="true" className="size-5" strokeWidth={2} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
