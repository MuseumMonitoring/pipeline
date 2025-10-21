# Start from a Node container
FROM node:lts-alpine

RUN apk add --no-cache bash

ARG FILES

WORKDIR /app/

# install dependencies into temp directory
# this will cache them and speed up future builds
COPY . /app/
RUN ls
RUN npm ci
RUN npm run build || true

ENTRYPOINT [ "npx", "rdfc"]
