import { createRoot, hydrateRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const container = document.getElementById('root')!;
const app = (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
const options = {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error: unknown, errorInfo: { componentStack?: string }) => {
    console.error(error, errorInfo.componentStack);
  },
};

// Public pages arrive prerendered (scripts/prerender.mjs): pick up that HTML
// instead of rebuilding it. Everything else arrives as an empty shell.
if (container.firstElementChild) {
  hydrateRoot(container, app, options);
} else {
  createRoot(container, options).render(app);
}
