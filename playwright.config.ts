import { defineConfig } from '@playwright/test'

// Instância isolada do app (portas próprias), para não brigar com um `pnpm dev` aberto.
const WEB = 'http://localhost:3010'
const env = { BETTER_AUTH_URL: WEB, NEXT_PUBLIC_RT_URL: 'http://localhost:4010' }

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // O app roda em modo dev (compila sob demanda); mais de 2 navegadores ao mesmo tempo estoura os tempos.
  workers: 2,
  use: { baseURL: WEB, trace: 'retain-on-failure', locale: 'pt-BR' },
  webServer: [
    { command: 'node --env-file-if-exists=../../.env src/server.ts', cwd: 'apps/realtime', url: 'http://localhost:4010/rt/health', env: { ...env, PORT: '4010' }, reuseExistingServer: true },
    { command: 'node scripts/assets.mjs && pnpm exec next dev -p 3010', cwd: 'apps/web', url: `${WEB}/api/auth/ok`, env: { ...env, NEXT_DIST_DIR: '.next-e2e' }, reuseExistingServer: true, timeout: 180_000 },
  ],
})
