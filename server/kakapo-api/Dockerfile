FROM node:20-alpine

WORKDIR /app/server/kakapo-api

COPY server/kakapo-api/package.json server/kakapo-api/package-lock.json ./
RUN npm ci --omit=dev

COPY server/kakapo-api/*.js ./
COPY server/kakapo-api/pg ./pg

RUN mkdir -p /app/lib /data
COPY lib/syncChangeLogCore.mjs /app/lib/syncChangeLogCore.mjs

ENV DATA_DIR=/data
ENV NODE_ENV=production

EXPOSE 8000
CMD ["node", "index.js"]