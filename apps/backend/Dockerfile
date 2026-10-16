FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm install --workspace=backend --include-workspace-root=false --no-audit --no-fund
COPY apps/backend apps/backend
RUN npm run build --workspace=backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma
WORKDIR /app/apps/backend
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
