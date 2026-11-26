# Airline check-in RPA: TypeScript compiled on the official Playwright image and
# run as the unprivileged pwuser with the bundled Chromium.
FROM mcr.microsoft.com/playwright:v1.65.1-noble AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.65.1-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    BROWSER_HEADLESS=true \
    MANIFEST_PATH=/app/data/passengers.csv \
    OUTPUT_DIR=/app/boarding_passes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY examples ./examples
RUN mkdir -p data boarding_passes && chown pwuser:pwuser data boarding_passes
USER pwuser
VOLUME ["/app/data", "/app/boarding_passes"]
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["run"]
