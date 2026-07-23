# Rootr CLI + MCP server.
# Runs the stdio MCP server by default:
#   docker run -i --rm -e ROOTR_API_KEY=... -e ROOTR_WORKSPACE=... rootr-cli
# Any CLI command works too:
#   docker run --rm -e ROOTR_API_KEY=... -e ROOTR_WORKSPACE=... rootr-cli ls
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY lib ./lib
COPY LICENSE README.md ./

ENV ROOTR_BASE_URL=https://rootr.io/api/v1

ENTRYPOINT ["node", "bin/rootr.js"]
CMD ["mcp"]
