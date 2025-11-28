# Start from a Node container
FROM node:lts-bookworm-slim

# Install bash via apt instead of apk
RUN apt-get update && \
    apt-get install -y --no-install-recommends bash && \
    rm -rf /var/lib/apt/lists/*

ARG FILES

WORKDIR /app/

# install dependencies into temp directory
# this will cache them and speed up future builds
COPY . /app/
RUN ls
RUN npm ci
RUN npm run build || true

ENTRYPOINT [ "npx", "rdfc"]
