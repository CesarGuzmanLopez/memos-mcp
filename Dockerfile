FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY dist/ ./dist/
RUN npm install --omit=dev @modelcontextprotocol/sdk express zod
EXPOSE 8443
ENV MEMOS_URL=https://your-memos-instance.com
ENV HTTP_HOST=0.0.0.0
CMD ["node", "dist/index.js", "--http", "--port", "8443"]
