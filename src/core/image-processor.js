/**
 * Image Processor
 *
 * Centralises all image processing logic that was previously duplicated
 * across export-service.js and storage.js.
 *
 * Exports a single `ImageProcessor` object with three public methods:
 *
 *   detectContentType(ctx, width, height)
 *     Edge-density heuristic — returns 'png' for text/UI content or
 *     'jpeg' for photo content.
 *
 *   processForExport(dataUrl, options)
 *     Full export pipeline used by ExportService.  Handles
 *     OffscreenCanvas (service-worker) and DOM (page) contexts.
 *     Returns { dataUrl, width, height, actualWidth, actualHeight, format }.
 *
 *   compressForStorage(dataUrl, options)
 *     Lightweight compression pipeline used by StorageManager.  Handles
 *     OffscreenCanvas and DOM contexts.
 *     Returns a compressed dataUrl string.
 */

import { Utils } from './utils.js';
import { Logger } from './logger.js';

export const ImageProcessor = {

  // ──────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────

  /**
   * Detect whether image content is text-heavy or photo-heavy using edge
   * density.  Samples a pixel region and counts sharp luminance
   * transitions.  High edge density = text/UI → PNG; Low = photo → JPEG.
   *
   * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @returns {'png'|'jpeg'}
   */
  detectContentType(ctx, width, height) {
    try {
      const sampleSize = Math.min(200, width, height);
      const imageData = ctx.getImageData(0, 0, Math.min(sampleSize, width), Math.min(sampleSize, height));
      const data = imageData.data;
      const w = imageData.width;

      let edgeCount = 0;
      let totalPixels = 0;
      const threshold = 30;

      for (let y = 0; y < imageData.height - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          const idxRight = (y * w + x + 1) * 4;
          const idxBelow = ((y + 1) * w + x) * 4;

          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          const lumRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
          const lumBelow = 0.299 * data[idxBelow] + 0.587 * data[idxBelow + 1] + 0.114 * data[idxBelow + 2];

          if (Math.abs(lum - lumRight) > threshold || Math.abs(lum - lumBelow) > threshold) {
            edgeCount++;
          }
          totalPixels++;
        }
      }

      const edgeDensity = totalPixels > 0 ? edgeCount / totalPixels : 0;
      Logger.debug(`🔍 Content detection: edge density = ${edgeDensity.toFixed(3)} → ${edgeDensity > 0.12 ? 'PNG (text/UI)' : 'JPEG (photo)'}`);
      return edgeDensity > 0.12 ? 'png' : 'jpeg';
    } catch (e) {
      return 'jpeg'; // Safe fallback
    }
  },

  /**
   * Process image for export with smart format selection.
   * - Text-heavy screenshots: export as PNG (preserves text clarity)
   * - Photo-heavy screenshots: export as JPEG (smaller file size)
   *
   * Returns both the actual pixel dimensions (actualWidth/actualHeight)
   * and the recommended display dimensions (width/height) for DOCX
   * embedding.  The image data is kept at high resolution so zooming in
   * reveals detail.
   *
   * @param {string} dataUrl - Original image data URL
   * @param {Object} [options]
   * @param {number} [options.maxWidth=1920]       Actual pixel cap
   * @param {number} [options.maxHeight=1080]      Actual pixel cap
   * @param {number} [options.displayWidth=600]    Display size in DOCX
   * @param {number} [options.displayHeight=450]   Display size in DOCX
   * @param {number} [options.quality=0.92]
   * @param {string} [options.format='auto']       'auto', 'png', 'jpeg-high', 'jpeg-standard'
   * @returns {Promise<{ dataUrl: string, width: number, height: number, actualWidth: number, actualHeight: number, format: string }>}
   */
  async processForExport(dataUrl, options = {}) {
    const {
      maxWidth = 1920,
      maxHeight = 1080,
      displayWidth = 600,
      displayHeight = 450,
      quality = 0.92,
      format = 'auto'
    } = options;

    const jpegQuality = format === 'jpeg-standard' ? 0.85 : quality;
    const useOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined';

    let result;
    if (useOffscreen) {
      result = await ImageProcessor._processImageOffscreen(dataUrl, maxWidth, maxHeight, jpegQuality, format);
    } else {
      result = await ImageProcessor._processImageDOM(dataUrl, maxWidth, maxHeight, jpegQuality, format);
    }

    // Calculate display dimensions that fit within displayWidth x displayHeight
    // while preserving aspect ratio
    const scale = Math.min(displayWidth / result.width, displayHeight / result.height, 1);
    result.actualWidth = result.width;
    result.actualHeight = result.height;
    result.width = Math.floor(result.width * scale);
    result.height = Math.floor(result.height * scale);

    return result;
  },

  /**
   * Compress a dataUrl for storage.
   * Equivalent to the former StorageManager._compressImage().
   *
   * @param {string} dataUrl - Original image data URL
   * @param {Object} [options]
   * @param {number} [options.maxWidth=1920]
   * @param {number} [options.maxHeight=1080]
   * @param {number} [options.quality=0.95]
   * @returns {Promise<string>} Compressed dataUrl (falls back to original on error)
   */
  async compressForStorage(dataUrl, options = {}) {
    const {
      maxWidth = 1920,
      maxHeight = 1080,
      quality = 0.95
    } = options;

    // Helper to check if we are in a Service Worker or similar context
    const useOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined';

    if (useOffscreen) {
      try {
        // Decode data URL directly to avoid fetch() memory double (HIGH-017)
        const blob = ImageProcessor._dataUrlToBlob(dataUrl);
        const bitmap = await createImageBitmap(blob);

        let { width, height } = bitmap;

        // Resize if too large
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d'); // alpha:false removed — blackens transparent pixels
        ctx.drawImage(bitmap, 0, 0, width, height);

        const compressedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });

        // Convert blob to dataUrl without FileReader (unavailable in SW)
        const buf = await compressedBlob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        const compressedDataUrl = `data:image/jpeg;base64,${btoa(binary)}`;

        bitmap.close();
        Logger.debug(`🗜️ Image compressed (Offscreen): ${(dataUrl.length / 1024).toFixed(1)}KB → ${(compressedDataUrl.length / 1024).toFixed(1)}KB`);

        return compressedDataUrl;
      } catch (error) {
        Logger.error('Offscreen image compression failed:', error);
        return dataUrl; // Fallback
      }
    } else {
      // Standard DOM implementation
      return new Promise((resolve) => {
        const img = new Image();

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let { width, height } = img;

            // Resize if too large
            if (width > maxWidth || height > maxHeight) {
              const ratio = Math.min(maxWidth / width, maxHeight / height);
              width = Math.floor(width * ratio);
              height = Math.floor(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

            Logger.debug(`🗜️ Image compressed: ${(dataUrl.length / 1024).toFixed(1)}KB → ${(compressedDataUrl.length / 1024).toFixed(1)}KB`);

            resolve(compressedDataUrl);
          } catch (error) {
            Logger.error('Image compression failed:', error);
            resolve(dataUrl); // Fallback to original
          }
        };

        img.onerror = () => {
          Logger.error('Failed to load image for compression');
          resolve(dataUrl); // Fallback to original
        };

        img.src = dataUrl;
      });
    }
  },

  // ──────────────────────────────────────────────────────────────────
  // Private helpers (OffscreenCanvas path)
  // ──────────────────────────────────────────────────────────────────

  async _processImageOffscreen(dataUrl, maxWidth, maxHeight, quality, format) {
    try {
      // Decode data URL directly to avoid fetch() memory double (HIGH-017)
      const blob = ImageProcessor._dataUrlToBlob(dataUrl);
      const bitmap = await createImageBitmap(blob);

      const { width: imgWidth, height: imgHeight } = bitmap;

      const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
      const canvasWidth = Math.floor(imgWidth * scale);
      const canvasHeight = Math.floor(imgHeight * scale);

      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      // alpha:false removed — it blackens transparent pixels (HIGH-018)
      const ctx = canvas.getContext('2d', { willReadFrequently: format === 'auto' });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);

      // Determine output format
      let outputFormat = format;
      if (outputFormat === 'auto') {
        outputFormat = ImageProcessor.detectContentType(ctx, canvasWidth, canvasHeight);
      }

      let outputBlob;
      if (outputFormat === 'png') {
        outputBlob = await canvas.convertToBlob({ type: 'image/png' });
        // Safety: if auto-selected PNG is >3x larger than JPEG, use JPEG (MED-017: only encode JPEG when needed)
        if (format === 'auto') {
          const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
          if (outputBlob.size > jpegBlob.size * 3) {
            outputBlob = jpegBlob;
            outputFormat = 'jpeg';
          }
        }
      } else {
        outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        outputFormat = 'jpeg';
      }

      bitmap.close();

      const outputDataUrl = await Utils.blobToDataURL(outputBlob);

      Logger.debug(`📐 Export image (Offscreen): ${imgWidth}x${imgHeight} → ${canvasWidth}x${canvasHeight} [${outputFormat}]`);
      return { dataUrl: outputDataUrl, width: canvasWidth, height: canvasHeight, format: outputFormat };
    } catch (error) {
      Logger.error('Offscreen export image processing failed:', error);
      return { dataUrl, width: 1200, height: 900, format: 'original' };
    }
  },

  // ──────────────────────────────────────────────────────────────────
  // Private helpers (DOM path)
  // ──────────────────────────────────────────────────────────────────

  async _processImageDOM(dataUrl, maxWidth, maxHeight, quality, format) {
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        try {
          const imgWidth = img.width;   // LOW-028: capture before img.src = '' clears them
          const imgHeight = img.height;
          const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
          const canvasWidth = Math.floor(imgWidth * scale);
          const canvasHeight = Math.floor(imgHeight * scale);

          const canvas = document.createElement('canvas');
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;

          const ctx = canvas.getContext('2d'); // alpha:false removed — blackens transparent pixels
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Step-down scaling for large reductions (better quality)
          if (canvasWidth < imgWidth * 0.5) {
            const tempCanvas = document.createElement('canvas');
            const intermediateWidth = Math.floor(imgWidth * 0.7);
            const intermediateHeight = Math.floor(imgHeight * 0.7);
            tempCanvas.width = intermediateWidth;
            tempCanvas.height = intermediateHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.imageSmoothingEnabled = true;
            tempCtx.imageSmoothingQuality = 'high';
            tempCtx.drawImage(img, 0, 0, intermediateWidth, intermediateHeight);
            ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);
            tempCanvas.width = 0;
            tempCanvas.height = 0;
          } else {
            ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
          }

          // Determine output format
          let outputFormat = format;
          if (outputFormat === 'auto') {
            outputFormat = ImageProcessor.detectContentType(ctx, canvasWidth, canvasHeight);
          }

          if (outputFormat === 'png') {
            const pngDataUrl = canvas.toDataURL('image/png');
            const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);

            // Safety: if PNG is >3x JPEG, use JPEG
            if (format === 'auto' && pngDataUrl.length > jpegDataUrl.length * 3) {
              outputFormat = 'jpeg';
              canvas.width = 0;
              canvas.height = 0;
              img.src = '';
              resolve({ dataUrl: jpegDataUrl, width: canvasWidth, height: canvasHeight, format: 'jpeg' });
              return;
            }

            canvas.width = 0;
            canvas.height = 0;
            img.src = '';
            resolve({ dataUrl: pngDataUrl, width: canvasWidth, height: canvasHeight, format: 'png' });
          } else {
            const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
            canvas.width = 0;
            canvas.height = 0;
            img.src = '';
            Logger.debug(`📐 Export image: ${imgWidth}x${imgHeight} → ${canvasWidth}x${canvasHeight} [jpeg]`);
            resolve({ dataUrl: jpegDataUrl, width: canvasWidth, height: canvasHeight, format: 'jpeg' });
          }
        } catch (error) {
          Logger.error('DOM export image processing failed:', error);
          img.src = '';
          resolve({ dataUrl, width: 1200, height: 900, format: 'original' });
        }
      };

      img.onerror = () => {
        Logger.error('Failed to load image for export processing');
        resolve({ dataUrl, width: 1200, height: 900, format: 'original' });
      };

      img.src = dataUrl;
    });
  }

};

/**
 * Decode a data URL directly to a Blob without a fetch() round-trip.
 * Avoids holding both the base64 string and the decoded byte array in memory
 * simultaneously (HIGH-017).
 * @param {string} dataUrl
 * @returns {Blob}
 */
ImageProcessor._dataUrlToBlob = function(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  const header = dataUrl.substring(0, commaIdx);
  const mime = header.split(':')[1].split(';')[0];
  const b64 = dataUrl.substring(commaIdx + 1);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
};
