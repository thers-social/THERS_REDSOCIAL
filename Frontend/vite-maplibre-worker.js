// Sirve el Web Worker de MapLibre GL JS 6 desde una ruta fija (/maplibre/maplibre-gl-worker.mjs).
//
// Por qué hace falta: MapLibre calcula la URL de su worker como "el archivo hermano del script
// que lo carga". Una vez empaquetado con Vite ese hermano no existe y el mapa se queda vacío con
// "Worker failed to load" (hallazgo de la prueba en navegador real, ADR-040 fase 3). Lo mismo
// ocurre en desarrollo, donde la librería se sirve pre-empaquetada.
//
// Así no se copia código de terceros al repositorio: se lee de node_modules en cada arranque/build.
// `PlacesMap.jsx` lo conecta con `setWorkerUrl()`. El archivo es del mismo origen, así que el CSP
// `worker-src 'self'` lo admite.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WORKER_FILE = 'maplibre-gl-worker.mjs'
const PUBLIC_PATH = `maplibre/${WORKER_FILE}`

export default function maplibreWorker() {
  const source = () =>
    readFileSync(fileURLToPath(new URL(`./node_modules/maplibre-gl/dist/${WORKER_FILE}`, import.meta.url)))

  return {
    name: 'thers-maplibre-worker',

    // `npm run dev`
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || request.url.split('?')[0] !== `/${PUBLIC_PATH}`) return next()
        response.setHeader('Content-Type', 'text/javascript')
        response.end(source())
      })
    },

    // `npm run build` y `npm run preview`
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: PUBLIC_PATH, source: source() })
    },
  }
}
