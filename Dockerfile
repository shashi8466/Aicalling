FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-fund --no-audit

# Copy source
COPY src ./src
COPY dashboard ./dashboard

# Logs directory
RUN mkdir -p logs

ENV NODE_ENV=production
ENV SKIP_TUNNEL=true
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
