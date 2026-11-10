import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

function onnxRuntimeWasmPlugin(): Plugin {
  const ortDistDir = path.resolve(import.meta.dirname, 'node_modules/onnxruntime-web/dist')
  const runtimeFiles = [
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
  ]

  return {
    name: 'folio-ort-wasm-assets',
    configureServer(server) {
      server.middlewares.use('/ort', (req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0].replace(/^\/+/, '')
        if (!cleanUrl || cleanUrl.includes('..')) return next()
        const filePath = path.join(ortDistDir, cleanUrl)
        if (!fs.existsSync(filePath)) return next()
        if (cleanUrl.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm')
        } else if (cleanUrl.endsWith('.mjs') || cleanUrl.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript')
        }
        fs.createReadStream(filePath).pipe(res)
      })
    },
    closeBundle() {
      const targetDir = path.resolve(import.meta.dirname, 'dist/ort')
      if (!fs.existsSync(ortDistDir)) return
      fs.mkdirSync(targetDir, { recursive: true })
      for (const file of runtimeFiles) {
        const src = path.join(ortDistDir, file)
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, file))
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), onnxRuntimeWasmPlugin()],
})
