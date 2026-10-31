# Imagem multi-arch (amd64 e arm64, p/ Oracle Ampere): docker buildx build --platform linux/amd64,linux/arm64 .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
# Em produção o navegador fala com o realtime pelo mesmo domínio (Caddy), então a URL fica vazia.
ENV NEXT_PUBLIC_RT_URL=""
RUN pnpm install --frozen-lockfile && pnpm --filter @grimorio/web build

FROM base AS web
# ffmpeg converte as músicas enviadas (lib/storage.ts).
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production HOSTNAME=0.0.0.0 UPLOAD_DIR=/data/uploads
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
CMD ["node", "apps/web/server.js"]

# ponytail: realtime roda o .ts direto (type stripping do Node 22) e leva o node_modules inteiro; podar com `pnpm deploy` se a imagem pesar
FROM base AS realtime
ENV NODE_ENV=production
COPY --from=build /app ./
# Aplica as migrações versionadas antes de subir (o banco nunca fica atrás do código).
CMD ["sh", "-c", "pnpm --filter @grimorio/db migrate && node apps/realtime/src/server.ts"]
