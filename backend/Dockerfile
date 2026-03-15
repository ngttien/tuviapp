FROM mcr.microsoft.com/playwright:v1.58.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 🔥 QUAN TRỌNG cho Playwright trong Docker
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps

EXPOSE 5000

CMD ["sh", "-c", "npm start & npm run worker"]