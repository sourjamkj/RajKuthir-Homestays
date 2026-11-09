/**
 * Checks an ID photo on the guest's phone before anything is uploaded, and
 * makes it smaller so a whole party's IDs go up quickly on weak data.
 *
 * - too small to read, too dark, or clearly blurred: refused, with what to do
 * - a little soft: a warning the guest can accept, because a photo of a card
 *   on a plain table measures softer than it looks and a false refusal at the
 *   front door is worse than one more look by the owner
 * - any photo the browser can open is re-saved as JPEG (iPhone HEIC included)
 * - PDFs go up as they are, within the size cap
 *
 * Blur is the variance of a Laplacian over a 480px grey copy: sharp edges give
 * large values, a shaken photo small ones.
 */

export type PhotoCheck =
  | { ok: true; warn?: string; blob: Blob; mimeType: string; filename: string; previewUrl: string | null; hash: string; note: string }
  | { ok: false; message: string; previewUrl?: string | null };

export const MIN_SHORT_SIDE = 600;
export const DARK_LIMIT = 45;
export const BLUR_REFUSE = 35;
export const BLUR_WARN = 80;
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
/** Raw bytes for one submit, so the request stays under the server's 12 MB body limit. */
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const LONG_SIDE = 1600;
const QUALITY = 0.82;

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('unreadable'));
    img.src = URL.createObjectURL(file);
  });
}

/** Sharpness and brightness of an image, from a small grey copy. */
export function measure(pixels: Uint8ClampedArray, width: number, height: number): { sharpness: number; brightness: number } {
  const grey = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < width * height; i += 1) {
    grey[i] = 0.299 * pixels[i * 4]! + 0.587 * pixels[i * 4 + 1]! + 0.114 * pixels[i * 4 + 2]!;
    sum += grey[i]!;
  }
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const l = 4 * grey[i]! - grey[i - 1]! - grey[i + 1]! - grey[i - width]! - grey[i + width]!;
      s += l;
      s2 += l * l;
      n += 1;
    }
  }
  return { sharpness: n ? s2 / n - (s / n) ** 2 : 0, brightness: sum / (width * height) };
}

export async function checkIdPhoto(file: File): Promise<PhotoCheck> {
  const name = file.name || 'id';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
  if (isPdf) {
    if (file.size > MAX_PDF_BYTES) return { ok: false, message: `This PDF is ${sizeText(file.size)}. Please use one under 4 MB, or take a photo of the ID instead.` };
    return { ok: true, blob: file, mimeType: 'application/pdf', filename: name, previewUrl: null, hash: await sha256(file), note: `PDF added (${sizeText(file.size)})` };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return { ok: false, message: 'This file could not be opened. Please take a photo with your camera, or upload a JPG or PDF.' };
  }
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const w = 480;
  const h = Math.max(1, Math.round((w * height) / width));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d');
  if (!sctx) return { ok: false, message: 'Your browser could not check this photo. Please try another browser.' };
  sctx.drawImage(img, 0, 0, w, h);
  const { sharpness, brightness } = measure(sctx.getImageData(0, 0, w, h).data, w, h);

  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const out = document.createElement('canvas');
  out.width = Math.round(width * scale);
  out.height = Math.round(height * scale);
  out.getContext('2d')?.drawImage(img, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', QUALITY));
  URL.revokeObjectURL(img.src);
  if (!blob) return { ok: false, message: 'This photo could not be prepared. Please try again.' };
  const previewUrl = URL.createObjectURL(blob);

  if (Math.min(width, height) < MIN_SHORT_SIDE) {
    return { ok: false, previewUrl, message: `This photo is too small to read (${width}×${height}). Retake it closer, so the ID fills the frame.` };
  }
  if (brightness < DARK_LIMIT) return { ok: false, previewUrl, message: 'This photo is too dark. Retake it near a window or with the lights on.' };
  if (sharpness < BLUR_REFUSE) return { ok: false, previewUrl, message: 'This photo is blurred. Hold the phone steady, tap the ID to focus, and retake.' };

  const filename = name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
  return {
    ok: true,
    blob,
    mimeType: 'image/jpeg',
    filename,
    previewUrl,
    hash: await sha256(file),
    note: `Clear photo · made smaller ${sizeText(file.size)} → ${sizeText(blob.size)}`,
    ...(sharpness < BLUR_WARN ? { warn: 'This photo looks a little soft. If the name and number are hard to read, please retake it.' } : {}),
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the document.'));
    reader.readAsDataURL(blob);
  });
}
