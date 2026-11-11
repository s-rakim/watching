# Build the web app
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --workspace web --include-workspace-root
COPY design design
COPY web web
RUN npm run build --workspace web

# Runtime: the server plus every tool it shells out to
FROM node:22-bookworm-slim

# Extra Tesseract language packs, space separated. English is always there.
# Example: docker compose build --build-arg OCR_LANGS="deu fra spa"
ARG OCR_LANGS="deu fra spa ita por nld"

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      qpdf ghostscript poppler-utils \
      ocrmypdf tesseract-ocr tesseract-ocr-eng \
      $(for l in $OCR_LANGS; do echo "tesseract-ocr-$(echo "$l" | tr '_' '-')"; done) \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      chromium \
      python3 python3-pip python3-pil \
      fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-cjk \
      fonts-crosextra-carlito fonts-crosextra-caladea \
      tini ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages pdf2docx pdfplumber openpyxl deepl \
 && apt-get purge -y python3-pip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.cache

WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --include-workspace-root && npm cache clean --force
COPY server server
COPY --from=web /app/web/dist web/dist

# The node image ships an unprivileged "node" user (uid 1000).
RUN mkdir -p /work && chown node:node /work
USER node

ENV NODE_ENV=production \
    PORT=8080 \
    WORK_DIR=/work \
    CHROMIUM_BIN=/usr/bin/chromium \
    HOME=/home/node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["npm", "run", "start", "--workspace", "server"]
