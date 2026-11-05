import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'clean-urls',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url?.split('?')[0];
            const search = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            if (url === '/authentication' || url === '/authentication/') {
              req.url = '/authentication.html' + search;
            } else if (url === '/app' || url === '/app/') {
              req.url = '/app.html' + search;
            }
            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url?.split('?')[0];
            const search = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            if (url === '/authentication' || url === '/authentication/') {
              req.url = '/authentication.html' + search;
            } else if (url === '/app' || url === '/app/') {
              req.url = '/app.html' + search;
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          authentication: path.resolve(__dirname, 'authentication.html'),
          app: path.resolve(__dirname, 'app.html'),
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
