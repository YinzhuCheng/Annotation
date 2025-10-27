import Dexie, { Table } from 'dexie';

export interface StoredImage {
  path: string; // images/<timestamp>.jpg
  blob: Blob;
}

class AppDB extends Dexie {
  images!: Table<StoredImage, string>;
  constructor() {
    super('local-annotation-db');
    this.version(1).stores({
      images: 'path'
    });
  }
}

export const db = new AppDB();

export async function saveImageBlob(blob: Blob): Promise<string> {
  const path = `images/${Date.now()}.jpg`;
  await db.images.put({ path, blob });
  return path;
}

export async function getImageBlob(path: string): Promise<Blob | undefined> {
  return db.images.get(path).then((r) => r?.blob);
}

// Save an image blob at a specified path (e.g., images/<id>.jpg)
export async function saveImageBlobAtPath(path: string, blob: Blob): Promise<void> {
  await db.images.put({ path, blob });
}
