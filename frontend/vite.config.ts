import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backendProxy: ProxyOptions = {
    target: env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest) => {
        proxyRequest.removeHeader('origin');
      });
    },
  };

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': backendProxy,
        '/health': backendProxy,
        '/ready': backendProxy,
        '/uploads': backendProxy,
      },
    },
  };
});
