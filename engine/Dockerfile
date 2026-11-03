# Kin engine API. Build from the repository root so the deployment files are in the context:
#   docker build -f engine/Dockerfile -t kin-engine .
#   docker run -p 8787:8787 --env-file engine/.env -v kin-data:/data kin-engine
FROM oven/bun:1
WORKDIR /app/engine
COPY engine/package.json engine/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY engine/src ./src
COPY engine/data/exclusions.json ./data/exclusions.json
COPY engine/replay ./replay
COPY contracts/deployments /app/contracts/deployments
ENV PORT=8787 DATA_DIR=/data
EXPOSE 8787
CMD ["bun", "run", "src/server.ts"]
