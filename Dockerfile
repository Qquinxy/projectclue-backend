# syntax=docker/dockerfile:1

# ---- Dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

RUN addgroup -S nodejs && adduser -S nodeapp -G nodejs

COPY --from=deps --chown=nodeapp:nodejs /app/node_modules ./node_modules
COPY --chown=nodeapp:nodejs . .

# Writable uploads dir for multer (club images). mount a volume here.
RUN mkdir -p /app/uploads && chown nodeapp:nodejs /app/uploads

USER nodeapp

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "server.js"]