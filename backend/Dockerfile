FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./

EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- "http://127.0.0.1:3000/download?bytes=1" > /dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
