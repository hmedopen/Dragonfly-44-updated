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

function chapterSnatchBackendPlugin(): Plugin {
  return {
    name: 'folio-chapter-snatch-backend',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/chapter-snatch/')) {
          return next()
        }
        // @ts-ignore
        const { fetchMetadata, downloadPageImage } = await import('./electron/chapterSnatchBackend.cjs')
        const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1:5173'}`)
        if (urlObj.pathname === '/api/chapter-snatch/metadata') {
          const targetUrl = urlObj.searchParams.get('url')
          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing "url" parameter.' }))
            return
          }
          try {
            const data = await fetchMetadata(targetUrl)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(data))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err?.message || 'Failed to fetch chapter metadata.' }))
          }
          return
        }
        if (urlObj.pathname === '/api/chapter-snatch/download-page') {
          const imageUrl = urlObj.searchParams.get('url')
          const referer = urlObj.searchParams.get('referer') || undefined
          if (!imageUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing "url" parameter.' }))
            return
          }
          try {
            const data = await downloadPageImage(imageUrl, referer)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(data))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err?.message || 'Failed to download page image.' }))
          }
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), onnxRuntimeWasmPlugin(), chapterSnatchBackendPlugin()],
})
