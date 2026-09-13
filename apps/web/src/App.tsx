import { useRoutes } from 'react-router-dom';
import { routeObjects } from './routes.js';
import { ToastProvider } from './components/ui/Toast.js';
import { ModalProvider } from './components/ui/Modal.js';
import { PaletteProvider } from './components/palette/paletteStore.js';

/**
 * Mounted inside a router by `main.tsx` (BrowserRouter) and by tests (MemoryRouter),
 * so route assertions never need a second entry point.
 */
export function App() {
  return (
    <ToastProvider>
      <ModalProvider>
        <PaletteProvider>
          <Routes />
        </PaletteProvider>
      </ModalProvider>
    </ToastProvider>
  );
}

function Routes() {
  return useRoutes(routeObjects);
}

export default App;
