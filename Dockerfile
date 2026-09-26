# ---- Étape 1 : installation et build ----
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
# Valeur factice : prisma.config.ts la lit, mais la génération du client ne se connecte pas à la base.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# ---- Étape 2 : image d'exécution ----
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json prisma.config.ts ./
EXPOSE 3000
# Au démarrage : migrations, données de départ (idempotentes), puis l'API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/prisma/seed.js && node dist/main.js"]
