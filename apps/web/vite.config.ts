import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Where the API is listening during development. */
const API = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Bind all interfaces so a phone on the same network can reach it.
    host: true,

    /**
     * Note there is deliberately no `allowedHosts` here, and this dev server is
     * never tunnelled.
     *
     * Camera work has to happen on a phone, and getUserMedia needs a secure
     * context, so the phone needs HTTPS. The tempting move is to tunnel this
     * server - but a dev server serves from the project root, and the root
     * contains .env with the auth signing secret. Instead the API serves the
     * built app, so the only thing ever exposed is compiled output.
     *
     * This server stays on localhost for desktop work, where HMR is useful and
     * the origin is already secure.
     */

    /**
     * Proxy the API through the dev server so the whole app is one origin.
     *
     * Three things this fixes at once:
     *
     *  - A tunnel exposes a single port. Without this, the tunnel would serve
     *    the UI while every API call still pointed at a machine the phone
     *    cannot reach.
     *  - Same-origin means no CORS in the request path at all, rather than an
     *    allowlist that has to anticipate addresses nobody can predict.
     *  - It matches how this deploys, with the API behind the same domain,
     *    so dev is not exercising a different topology from production.
     */
    proxy: {
      '/v1': { target: API, changeOrigin: true },
      '/dev': { target: API, changeOrigin: true },
      '/media': { target: API, changeOrigin: true },
      '/health': { target: API, changeOrigin: true },
      '/ready': { target: API, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
