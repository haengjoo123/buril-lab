import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** PDF.js needs named (not hashed) CMaps, standard fonts and image decoders. */
export function pdfJsAssets(): Plugin {
  const root = path.resolve('node_modules/pdfjs-dist')
  const assets = new Map<string, string>()
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
      if (entry.isFile()) assets.set(`pdfjs/${folder}/${entry.name}`, path.join(root, folder, entry.name))
    }
  }
  return {
    name: 'inventory-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/^\//, '')
        const file = assets.get(pathname)
        if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
      })
    },
    generateBundle() {
      for (const [fileName, file] of assets) this.emitFile({ type: 'asset', fileName, source: readFileSync(file) })
    },
  }
}
