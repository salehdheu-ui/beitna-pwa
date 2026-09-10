FROM node:20-alpine
WORKDIR /app
COPY server.js ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
