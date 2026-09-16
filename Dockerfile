FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
EXPOSE 8443
ENV MEMOS_URL=https://your-memos-instance.com
ENV HTTP_HOST=0.0.0.0
CMD ["node", "dist/index.js", "--http", "--port", "8443"]
