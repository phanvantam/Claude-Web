import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Inject build version vào HTML (%VITE_BUILD_VERSION%) và JS (import.meta.env.VITE_BUILD_VERSION)
  define: {
    '__BUILD_TIME__': JSON.stringify(new Date().toISOString()),
  },
  // Cho phép Vite serve file từ thư mục node_modules/monaco-editor
  server: {
    port: 5173,
    fs: {
      allow: [
        // Workspace root
        path.resolve(__dirname, '..'),
        // Monaco editor assets — cho phép serve trực tiếp từ node_modules
        path.resolve(__dirname, 'node_modules/monaco-editor'),
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('[vite] proxy error (suppressed):', (err as any).code || err.message);
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', (err) => {
              console.log('[vite] ws socket error (suppressed):', (err as any).code || err.message);
            });
          });
        },
      },
    },
  },
})

