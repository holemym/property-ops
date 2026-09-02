// Copies maplibre-gl's standalone worker build into public/ so the map can spawn it
// as a real same-origin script (VectorMap.tsx calls setWorkerUrl('/maplibre-gl-csp-worker.js')).
//
// WHY THIS EXISTS (hard-won, verified live): maplibre cannot be safely BUNDLED by
// Turbopack in either major. v5's default build reconstructs its worker source by
// Function.prototype.toString()-ing its own module factories at runtime — minified
// bundler output corrupts that silently. v6 resolves a separate worker via
// new URL('./maplibre-gl-worker.mjs', import.meta.url) — an asset emission Turbopack
// drops silently. Both present identically in production: style + sprites + markers
// load, ZERO tile requests, empty beige map, nothing in the console. The CSP build
// pair (main + explicit worker file) is maplibre's own answer for exactly this.
//
// Runs via the predev/prebuild hooks, so the copy always matches the installed
// maplibre version; public/maplibre-gl-csp-worker.js is gitignored (build artifact).
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-csp-worker.js')
const dest = join(root, 'public', 'maplibre-gl-csp-worker.js')

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log('[maplibre-worker] copied dist/maplibre-gl-csp-worker.js -> public/')
