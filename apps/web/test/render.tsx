import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ModalProvider } from '../src/components/ui/Modal.js';
import { ToastProvider } from '../src/components/ui/Toast.js';

export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string } = {},
): RenderResult & { qc: QueryClient } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[opts.route ?? '/library']}>
          {/* Same nesting as `App.tsx`. Components rendered on their own still use
              `useModal`/`useToast`, which are silent no-ops without a provider; tests that
              render `<App />` simply get a harmless second, inner pair. */}
          <ToastProvider>
            <ModalProvider>{ui}</ModalProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
