import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App.tsx';
import { ApiError } from './lib/api.ts';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Diary data changes when the user acts, not on its own. Refetching on
      // every window focus would re-issue signed photo URLs constantly.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry a refusal or a validation failure. A tier mismatch is an
        // answer, not a transient fault, and retrying it three times just
        // delays showing the user why.
        if (error instanceof ApiError) {
          if (error.status === 0) return failureCount < 2;
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 1;
      },
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
