// Empacota a API da nuvem num arquivo so (dist/api.mjs). As dependencias
// ficam de fora e vem do node_modules; o NODE_ENV fixo desliga o pino-pretty.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/cli/api.ts'],
  outfile: 'dist/api.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})
