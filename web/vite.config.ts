import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    /* 开发时前端在 5173、后端在 5180，/api 反代过去。
     * 这样前端代码里永远写相对路径 `/api/...`，
     * 生产环境同源部署时不用改任何东西。 */
    proxy: {
      '/api': {
        target: process.env.KUKE_API || 'http://127.0.0.1:5180',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // 不生成 sourcemap：这是教学系统，产物要能直接看，不需要调试映射
    sourcemap: false,
    rollupOptions: {
      output: {
        /* 把体积大且更新频率低的依赖拆出去。
         * 注意：Rolldown（Vite 8 的打包器）下 manualChunks 只接受函数形式，
         * 对象形式会直接构建失败。 */
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
          if (id.includes('node_modules/react-router')) return 'router';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
});
