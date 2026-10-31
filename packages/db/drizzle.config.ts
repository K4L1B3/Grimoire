import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

if (existsSync('../../.env')) process.loadEnvFile('../../.env')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
