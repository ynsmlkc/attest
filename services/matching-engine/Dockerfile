FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js matcher.js ./
EXPOSE 80
CMD ["node", "index.js"]
