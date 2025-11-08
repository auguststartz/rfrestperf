# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# Skip postinstall script as it's only needed for Electron app, not for the REST API server
RUN npm ci --omit=dev --ignore-scripts

# Copy application source
COPY src/ ./src/
COPY .env.example ./.env.example

# Create directory for uploaded files
RUN mkdir -p /app/uploads && chmod 777 /app/uploads

# Expose the application port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "src/server.js"]
