// BEACON — client providers tree (E8·T-348; ADR-002). Wraps the app in the TanStack Query cache + the
// sonner toaster (polite aria-live). Theme is driven by the [data-theme] attribute on <html> (set in
// layout + toggled client-side); this provider only owns the server-cache + toast surfaces.
'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { makeQueryClient } from './query-client.js';

export function Providers({ children }: { children: ReactNode }): ReactNode {
  // One client per app instance (useState initializer — never recreated on re-render).
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 6000 }} />
    </QueryClientProvider>
  );
}
