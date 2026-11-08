import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

import { deduplicateOnUpload, cleanupAllDuplicates } from './imagekit-server.ts';

function parseJsonBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: any) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'clean-urls-and-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url?.split('?')[0];
            const search = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

            // ImageKit storage deduplication API endpoints
            if (url === '/api/imagekit/deduplicate' && req.method === 'POST') {
              const body = await parseJsonBody(req);
              const result = await deduplicateOnUpload(body);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
              return;
            }
            if ((url === '/api/imagekit/cleanup-all' || url === '/api/imagekit/cleanup-all/') && (req.method === 'POST' || req.method === 'GET')) {
              const result = await cleanupAllDuplicates();
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
              return;
            }

            // Clean URLs routing
            if (url === '/authentication' || url === '/authentication/') {
              req.url = '/authentication.html' + search;
            } else if (url === '/app' || url === '/app/') {
              req.url = '/app.html' + search;
            }
            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url?.split('?')[0];
            const search = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

            if (url === '/api/imagekit/deduplicate' && req.method === 'POST') {
              const body = await parseJsonBody(req);
              const result = await deduplicateOnUpload(body);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
              return;
            }
            if ((url === '/api/imagekit/cleanup-all' || url === '/api/imagekit/cleanup-all/') && (req.method === 'POST' || req.method === 'GET')) {
              const result = await cleanupAllDuplicates();
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
              return;
            }

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
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(import.meta.dirname, 'index.html'),
          authentication: path.resolve(import.meta.dirname, 'authentication.html'),
          app: path.resolve(import.meta.dirname, 'app.html'),
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
