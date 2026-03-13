FROM node:20-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src/ src/
RUN npm install && npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist/ dist/
COPY --from=build /app/node_modules/ node_modules/
COPY package.json ./
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/index.js"]
