FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install clean production and dev dependencies
RUN npm ci

# Copy application source code
COPY . .

# Default runtime environment variables
ENV NODE_ENV=production
ENV BROWSER_HEADLESS=true
ENV BROWSER_SLOW_MO=0
ENV LOG_LEVEL=info
ENV LOG_CONSOLE=true

# Persistent volume mounts for boarding passes, logs and CSV
VOLUME ["/app/boarding_passes", "/app/logs"]

CMD ["npm", "start"]
