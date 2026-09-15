import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { installPreloadErrorReload } from './lib/chunkError.js';
import './styles/app.css';

/**
 * Before anything renders (review H1). A deploy replaces every hashed asset, so the first lazy
 * route an already-open tab reaches 404s; Vite fires `vite:preloadError` and this turns the dead
 * chunk into a reload that picks up the new `index.html`.
 */
installPreloadErrorReload();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } },
});

async function boot() {
  // `VITE_MOCK_API` is statically replaced, so this import is dropped from a normal build.
  if (import.meta.env.VITE_MOCK_API === '1') {
    const { worker } = await import('../test/msw/browser.js');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void boot();
