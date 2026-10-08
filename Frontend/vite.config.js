import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import seoFiles from './vite-seo-files.js'
import maplibreWorker from './vite-maplibre-worker.js'

export default defineConfig(({ mode }) => {
  // VITE_SITE_URL decide las URLs absolutas de robots.txt y sitemap.xml
  // (ADR-033-seo-foundation.md).
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react(), seoFiles(env.VITE_SITE_URL), maplibreWorker()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@features': path.resolve(__dirname, './src/features'),
        '@shared': path.resolve(__dirname, './src/shared'),
        '@assets': path.resolve(__dirname, './src/assets'),
      }
    }
  }
})
