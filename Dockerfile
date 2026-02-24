FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

COPY actor.yaml input.schema.json output.schema.json ui.schema.json example.input.json run.profile.json ./
COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "run", "start"]
