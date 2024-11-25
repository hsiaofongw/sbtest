FROM node:22.11.0 AS build

WORKDIR /app/build

COPY . .

RUN npm ci

RUN npm run build

FROM node:22.11.0 AS run

WORKDIR /app

COPY --from=build /app/build/dist/app.js .

ENTRYPOINT [ "/usr/local/bin/node", "/app/app.js" ]
