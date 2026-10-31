import { existsSync } from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

// Em dev o .env fica na raiz do monorepo; no Docker as variáveis vêm do compose.
const rootEnv = path.join(import.meta.dirname, '../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

const config: NextConfig = {
  output: 'standalone',
  // O E2E sobe uma instância própria ao lado do dev normal, com pasta de build separada.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@grimorio/core', '@grimorio/db'],
  serverExternalPackages: ['@node-rs/argon2', 'sharp'],
}

export default createNextIntlPlugin('./i18n/request.ts')(config)
