FROM node:18-alpine

WORKDIR /app

# Dependencies first (lock is optional)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev

# App code
COPY index.js ./index.js
COPY src ./src
COPY access.txt ./access.txt

EXPOSE 3000
CMD ["node", "index.js"]
