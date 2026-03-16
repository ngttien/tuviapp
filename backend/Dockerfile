FROM mcr.microsoft.com/playwright:v1.58.0-jammy

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Playwright browser path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 5000

CMD ["sh", "-c", "npm start & npm run worker && wait"]