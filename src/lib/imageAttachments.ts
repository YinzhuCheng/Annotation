import { getImageBlob } from './db';
import { blobToDataUrl } from './blob';

export async function resolveImageDataUrl(imagePath?: string | null): Promise<string | null> {
  const trimmed = imagePath?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  let blob: Blob | undefined;
  if (trimmed.startsWith('images/')) {
    blob = await getImageBlob(trimmed);
  }
  if (!blob) {
    try {
      const response = await fetch(trimmed);
      if (response.ok) {
        blob = await response.blob();
      }
    } catch {
      // Ignore network errors and fall through to return null
    }
  }
  if (!blob) {
    return null;
  }
  return blobToDataUrl(blob);
}
