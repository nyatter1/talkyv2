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

/**
 * Directly uploads any image or animated GIF file to ImageKit CDN via the official ImageKit REST API.
 * Returns the hosted ImageKit URL (e.g., https://ik.imagekit.io/talky/avatar_12345.gif).
 */
export async function uploadToImageKit(fileOrDataUrl: File | Blob | string, customFileName?: string): Promise<string> {
  if (!fileOrDataUrl) return '';

  try {
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
    formData.append('useUniqueFileName', 'true');

    const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.url) {
        return data.url;
      }
    } else {
      console.warn('ImageKit API error status:', response.status, await response.text());
    }
  } catch (err) {
    console.warn('ImageKit direct upload failed, falling back to local processing:', err);
  }

  // Fallback to local Data URL if network/upload fails
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
 * Uploads any image/GIF directly to ImageKit CDN and returns the direct ImageKit URL!
 */
export async function processImageUpload(fileOrUrl: File | Blob | string, maxWidth = 960, maxHeight = 960, quality = 0.82): Promise<string> {
  if (!fileOrUrl) return '';

  // If already an HTTP/HTTPS URL
  if (typeof fileOrUrl === 'string' && (fileOrUrl.startsWith('http://') || fileOrUrl.startsWith('https://'))) {
    return fileOrUrl;
  }

  // Directly upload File / Blob / Data URL to ImageKit
  const ikUrl = await uploadToImageKit(fileOrUrl);
  if (ikUrl) {
    return ikUrl;
  }

  // Local Data URL fallback if ImageKit fails
  return fallbackReadLocal(fileOrUrl);
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
