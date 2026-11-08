/**
 * ImageKit Direct API Upload & Media Integration Utility for Talky V2
 * ImageKit ID: talky
 */

export const IMAGEKIT_ID = 'talky';
export const IMAGEKIT_ENDPOINT = 'https://ik.imagekit.io/talky';
export const IMAGEKIT_PUBLIC_KEY = 'public_vDOU7yVO7Jzk1Vd6JW4Eqk8jYYI=';
export const IMAGEKIT_PRIVATE_KEY = 'private_upIy1erri62cI4TohevuETFkvvk=';

/**
 * Generates HMAC-SHA1 signature for ImageKit Upload API using Web Crypto API
 */
async function generateImageKitSignature(privateKey: string, token: string, expire: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(privateKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signatureBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(token + expire)
  );
  return Array.from(new Uint8Array(signatureBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export type UploadProgressCallback = (percent: number) => void;
let globalUploadProgressHandler: UploadProgressCallback | null = null;

/**
 * Sets a global listener for upload progress (1% - 100%)
 */
export function setGlobalUploadProgressHandler(handler: UploadProgressCallback | null) {
  globalUploadProgressHandler = handler;
}

/**
 * Dispatches progress update to registered handler and global custom event
 */
export function reportUploadProgress(percent: number, customCallback?: UploadProgressCallback) {
  const safePercent = Math.min(100, Math.max(1, Math.round(percent)));
  if (customCallback) {
    try { customCallback(safePercent); } catch {}
  }
  if (globalUploadProgressHandler) {
    try { globalUploadProgressHandler(safePercent); } catch {}
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('talky:upload-progress', { detail: { percent: safePercent } }));
  }
}

/**
 * Calls backend proxy to delete duplicate or similar-named files in ImageKit storage
 */
export async function triggerImageKitDeduplication(params: {
  fileName?: string;
  fileId?: string;
  size?: number;
}): Promise<{ success: boolean; deletedCount?: number }> {
  try {
    const res = await fetch('/api/imagekit/deduplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('ImageKit deduplication request warning:', err);
  }
  return { success: false };
}

/**
 * Runs a comprehensive sweep across ImageKit storage, deleting redundant duplicate copies
 */
export async function sweepImageKitStorageDuplicates(): Promise<{
  success: boolean;
  totalDeleted?: number;
  deletedIds?: string[];
}> {
  try {
    const res = await fetch('/api/imagekit/cleanup-all', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    console.warn('ImageKit storage sweep warning:', err);
  }
  return { success: false };
}

export interface CompressionProgressData {
  originalSize: number;
  currentSize: number;
  targetSize: number;
  percent?: number;
  phase: 'compressing' | 'uploading' | 'complete';
}

/**
 * Dispatches compression and size-reduction updates to the UI
 */
export function reportCompressionProgress(data: CompressionProgressData) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('talky:compression-progress', { detail: data }));
  }
}

export interface ProcessedUploadResult {
  url: string;
  size: number;
  originalSize: number;
  name: string;
  isGif: boolean;
}

/**
 * Directly uploads any image or animated GIF file to ImageKit CDN via the official ImageKit REST API.
 * Emits real 1% - 100% progress events and triggers deduplication to save storage quota.
 * Returns the hosted ImageKit URL (e.g., https://ik.imagekit.io/talky/avatar_12345.gif).
 */
export async function uploadToImageKit(
  fileOrDataUrl: File | Blob | string,
  customFileName?: string,
  onProgress?: UploadProgressCallback
): Promise<string> {
  if (!fileOrDataUrl) return '';

  try {
    reportUploadProgress(1, onProgress);
    const token = 'token_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const expire = Math.floor(Date.now() / 1000 + 1800).toString();
    const signature = await generateImageKitSignature(IMAGEKIT_PRIVATE_KEY, token, expire);

    let fileName = customFileName || 'media_' + Date.now();
    if (fileOrDataUrl instanceof File && fileOrDataUrl.name) {
      fileName = fileOrDataUrl.name;
    } else if (isGifMedia(fileOrDataUrl) && !fileName.endsWith('.gif')) {
      fileName += '.gif';
    } else if (!fileName.includes('.')) {
      fileName += '.png';
    }

    const formData = new FormData();

    if (typeof fileOrDataUrl === 'string') {
      // Base64 Data URL or HTTP URL
      formData.append('file', fileOrDataUrl);
    } else {
      // File or Blob object
      formData.append('file', fileOrDataUrl);
    }

    formData.append('fileName', fileName);
    formData.append('publicKey', IMAGEKIT_PUBLIC_KEY);
    formData.append('signature', signature);
    formData.append('expire', expire);
    formData.append('token', token);
    // Disallow duplicate creation on ImageKit for identical names
    formData.append('useUniqueFileName', 'false');
    formData.append('overwriteFile', 'true');

    // Aggressive storage-time compression before saving to ImageKit media library
    if (isGifMedia(fileOrDataUrl)) {
      // Resizes GIF to max width 380px and compresses color palettes to drastically cut GIF file size
      formData.append('transformation[pre]', 'w-380,q-48');
    } else {
      // Resizes static images to max width 720px with high-efficiency 65% quality compression
      formData.append('transformation[pre]', 'w-720,q-65');
    }

    // Use XMLHttpRequest for actual byte upload progress tracking (1% to 100%)
    const uploadResult = await new Promise<any>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://upload.imagekit.io/api/v1/files/upload');

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          const rawPct = Math.min(99, Math.max(1, Math.round((evt.loaded / evt.total) * 100)));
          reportUploadProgress(rawPct, onProgress);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve(null);
          }
        } else {
          console.warn('ImageKit XHR upload failed with status:', xhr.status, xhr.responseText);
          resolve(null);
        }
      };

      xhr.onerror = () => {
        console.warn('ImageKit XHR upload encountered network error');
        resolve(null);
      };

      xhr.send(formData);
    });

    if (uploadResult && uploadResult.url) {
      // Hit 100% on upload completion
      reportUploadProgress(100, onProgress);

      // Automatically delete any duplicates or files with similar names in ImageKit storage
      triggerImageKitDeduplication({
        fileName: uploadResult.name || fileName,
        fileId: uploadResult.fileId,
        size: uploadResult.size
      }).catch(err => console.warn('Background deduplication error:', err));

      return uploadResult.url;
    }
  } catch (err) {
    console.warn('ImageKit direct upload failed, falling back to local processing:', err);
  }

  // Fallback to local Data URL if network/upload fails
  reportUploadProgress(100, onProgress);
  return fallbackReadLocal(fileOrDataUrl);
}

/**
 * Local fallback reader if direct ImageKit upload is unavailable
 */
function fallbackReadLocal(source: File | Blob | string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof source === 'string') return resolve(source);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(source as Blob);
  });
}

/**
 * Normalizes an ImageKit URL or external URL
 */
export function normalizeImageKitUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  const trimmed = pathOrUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  const cleanPath = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  return `${IMAGEKIT_ENDPOINT}/${cleanPath}`;
}

/**
 * Checks if a file or string is an animated GIF
 */
export function isGifMedia(source: any): boolean {
  if (!source) return false;
  if (typeof source === 'string') {
    return source.startsWith('data:image/gif') || source.toLowerCase().includes('.gif');
  }
  if (source instanceof File) {
    return source.type === 'image/gif' || source.name.toLowerCase().endsWith('.gif');
  }
  if (source instanceof Blob) {
    return source.type === 'image/gif';
  }
  return false;
}

/**
 * Compresses static images using HTML5 Canvas to reduce file size by 75-90% while maintaining crisp visual quality.
 * Preserves transparency and uses modern webp format with fallback to jpeg.
 */
export async function compressStaticImage(source: File | Blob | string, maxWidth = 720, maxHeight = 720, quality = 0.65): Promise<string> {
  return new Promise((resolve) => {
    if (!source) return resolve('');

    const processImg = (img: HTMLImageElement) => {
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (!width || !height) return resolve(typeof source === 'string' ? source : '');

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(typeof source === 'string' ? source : '');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first for highest fidelity compression, fallback to JPEG
        let compressed = canvas.toDataURL('image/webp', quality);
        if (!compressed.startsWith('data:image/webp')) {
          compressed = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(compressed);
      } catch (err) {
        console.warn('Canvas compression fallback:', err);
        resolve(typeof source === 'string' ? source : '');
      }
    };

    if (typeof source === 'string') {
      if (!source.startsWith('data:image')) {
        return resolve(source);
      }
      const img = new Image();
      img.onload = () => processImg(img);
      img.onerror = () => resolve(source);
      img.src = source;
    } else if (source instanceof File || source instanceof Blob) {
      const url = URL.createObjectURL(source);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        processImg(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve('');
      };
      img.src = url;
    } else {
      resolve('');
    }
  });
}

/**
 * Detailed upload processor returning full size metadata (original size, compressed size, URL)
 * Broadcasts decreasing size animation events during compression.
 */
export async function processImageUploadDetailed(
  fileOrUrl: File | Blob | string,
  maxWidth = 720,
  maxHeight = 720,
  quality = 0.65,
  onProgress?: UploadProgressCallback
): Promise<ProcessedUploadResult> {
  const isGif = isGifMedia(fileOrUrl);
  let fileName = 'attachment_' + Date.now();
  let originalSize = 100000;

  if (fileOrUrl instanceof File) {
    originalSize = fileOrUrl.size;
    fileName = fileOrUrl.name;
  } else if (fileOrUrl instanceof Blob) {
    originalSize = fileOrUrl.size;
  } else if (typeof fileOrUrl === 'string') {
    if (fileOrUrl.startsWith('data:')) {
      originalSize = Math.round(fileOrUrl.length * 0.75);
    }
  }

  // If already an HTTP/HTTPS URL
  if (typeof fileOrUrl === 'string' && (fileOrUrl.startsWith('http://') || fileOrUrl.startsWith('https://'))) {
    const url = fileOrUrl.includes('ik.imagekit.io') && !fileOrUrl.includes('?tr=')
      ? `${fileOrUrl}?tr=q-70,f-auto`
      : fileOrUrl;
    return { url, size: originalSize, originalSize, name: fileName, isGif };
  }

  // Phase 1: Notify start of compression with original size
  reportCompressionProgress({
    originalSize,
    currentSize: originalSize,
    targetSize: originalSize,
    phase: 'compressing'
  });

  let payloadToUpload: File | Blob | string = fileOrUrl;
  let compressedLocal = '';
  let estimatedCompressedSize = Math.round(originalSize * 0.35); // Default target estimate

  if (!isGif) {
    compressedLocal = await compressStaticImage(fileOrUrl, maxWidth, maxHeight, quality);
    if (compressedLocal) {
      payloadToUpload = compressedLocal;
      estimatedCompressedSize = Math.round(compressedLocal.length * 0.75);
    }
  }

  // Smoothly decrease size from originalSize down to estimatedCompressedSize
  const steps = 8;
  const decrement = Math.round((originalSize - estimatedCompressedSize) / steps);
  let currentDecreasing = originalSize;

  for (let i = 0; i < steps; i++) {
    currentDecreasing = Math.max(estimatedCompressedSize, currentDecreasing - decrement);
    reportCompressionProgress({
      originalSize,
      currentSize: currentDecreasing,
      targetSize: estimatedCompressedSize,
      phase: 'compressing'
    });
    // Brief async tick for smooth visual decrement effect
    await new Promise(r => setTimeout(r, 40));
  }

  // Phase 2: Upload to ImageKit CDN with real byte progress
  reportCompressionProgress({
    originalSize,
    currentSize: estimatedCompressedSize,
    targetSize: estimatedCompressedSize,
    phase: 'uploading'
  });

  const ikUrl = await uploadToImageKit(payloadToUpload, fileName, (p) => {
    reportUploadProgress(p, onProgress);
    reportCompressionProgress({
      originalSize,
      currentSize: estimatedCompressedSize,
      targetSize: estimatedCompressedSize,
      percent: p,
      phase: 'uploading'
    });
  });

  const finalUrl = ikUrl
    ? (ikUrl.includes('?tr=') ? ikUrl : `${ikUrl}?tr=q-70,f-auto`)
    : (compressedLocal || fallbackReadLocal(fileOrUrl) as unknown as string);

  reportCompressionProgress({
    originalSize,
    currentSize: estimatedCompressedSize,
    targetSize: estimatedCompressedSize,
    percent: 100,
    phase: 'complete'
  });

  return {
    url: finalUrl,
    size: estimatedCompressedSize,
    originalSize,
    name: fileName,
    isGif
  };
}

/**
 * Uploads any image/GIF directly to ImageKit CDN and returns the direct ImageKit URL!
 * Employs heavy compression for GIFs (pre-transformed dimensions and colors) and static images.
 */
export async function processImageUpload(
  fileOrUrl: File | Blob | string,
  maxWidth = 720,
  maxHeight = 720,
  quality = 0.65,
  onProgress?: UploadProgressCallback
): Promise<string> {
  const result = await processImageUploadDetailed(fileOrUrl, maxWidth, maxHeight, quality, onProgress);
  return result.url;
}

// Curated GIF presets
export const GIF_PRESETS = {
  avatars: [
    {
      id: 'neon_cat',
      name: 'Cyberpunk Pixel Cat',
      url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2JpNGx5MHk1MWx6b2hrczVvYTVzcjU1cnJqZTNua3A5ZXAxa2QwayZlcD12MV9naWZzX3NlYXJjaCZjdD1n/JIX9t2j0ZTN9S/giphy.gif'
    }
  ]
};
