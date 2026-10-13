import { defineConfig } from 'vitest/config'

// os testes do backend ficam em tests/; o app Angular (web/) tem os dele
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } })
