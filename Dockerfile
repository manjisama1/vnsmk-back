# Use Node.js 20 LTS (latest stable) with Alpine for smaller image size
FROM node:20-alpine

# Set metadata
LABEL maintainer="Vinsmoke Team"
LABEL description="Vinsmoke WhatsApp Bot Backend API"
LABEL version="1.0.0"

# Install system dependencies for production
RUN apk add --no-cache \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S vinsmoke -u 1001

# Set working directory
WORKDIR /app

# Copy package files first (for better Docker layer caching)
COPY --chown=vinsmoke:nodejs package*.json ./

# Install dependencies with production optimizations
RUN npm ci --only=production --silent && \
    npm cache clean --force

# Copy source code with proper ownership
COPY --chown=vinsmoke:nodejs . .

# Create necessary directories with proper permissions
RUN mkdir -p sessions data logs && \
    chown -R vinsmoke:nodejs sessions data logs

# Switch to non-root user
USER vinsmoke

# Use standard port 8080 (cloud platforms prefer this)
EXPOSE 8080

# Set production environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_LOGLEVEL=warn

# Health check with proper intervals for production
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://127.0.0.1:$PORT/api/health || exit 1

# Use dumb-init to handle signals properly in containers
ENTRYPOINT ["dumb-init", "--"]

# Start the application with proper process management
CMD ["node", "server.js"]