FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js addon.js ./
USER node
EXPOSE 5310
CMD ["node","server.js"]
