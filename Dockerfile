FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4000
ENV CORS_ORIGIN=*

EXPOSE 4000
CMD ["npm", "start"]
