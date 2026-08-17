FROM node:20-slim

# poppler-utils (pdftoppm) — rasterizes PDF pages to PNG for
# ocr/pdfRasterizer.js, so tesseractOcr.js's own image-only OCR can
# process a PDF the same way it already does a plain photo. System
# dependency, not an npm package: no pure-JS pdftoppm equivalent exists
# that doesn't itself just wrap this same native binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "src/index.js"]
