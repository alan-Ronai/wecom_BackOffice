import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

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
        <MemoryRouter initialEntries={[opts.route ?? '/library']}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
