export const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};

const FALLBACK_EXTENSION = 'dat';

export function formatTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function inferExtension(source: { name?: string; type?: string }, fallback = FALLBACK_EXTENSION): string {
  const name = source.name || '';
  if (name && name.includes('.')) {
    const ext = name.substring(name.lastIndexOf('.') + 1).trim();
    if (ext) {
      return ext.toLowerCase();
    }
  }
  const type = (source.type || '').toLowerCase();
  if (type && MIME_EXTENSION_MAP[type]) {
    return MIME_EXTENSION_MAP[type];
  }
  if (type.startsWith('image/')) {
    const imageExt = type.substring('image/'.length).trim();
    if (imageExt) {
      return imageExt.replace('jpeg', 'jpg');
    }
  }
  if (type === 'text/plain') {
    return 'txt';
  }
  if (type === 'application/json') {
    return 'json';
  }
  if (type.startsWith('application/')) {
    const appExt = type.substring('application/'.length).trim();
    if (appExt) {
      if (appExt.includes('spreadsheetml.sheet')) return 'xlsx';
      if (appExt.includes('pdf')) return 'pdf';
      if (appExt.includes('zip')) return 'zip';
    }
  }
  return fallback;
}

export function buildDisplayName(ext: string, options?: { index?: number; total?: number; base?: string }): string {
  const timestamp = options?.base ?? formatTimestamp();
  const needsIndex = (options?.total ?? 0) > 1;
  const indexSuffix = needsIndex || typeof options?.index === 'number'
    ? `-${((options?.index ?? 0) + 1)}`
    : '';
  const normalizedExt = ext ? ext.replace(/^\./, '') : '';
  return `${timestamp}${indexSuffix}${normalizedExt ? `.${normalizedExt}` : ''}`;
}

export function buildBatchLabel(ext: string, count: number, base?: string): string {
  const timestamp = base ?? formatTimestamp();
  const normalizedExt = ext ? ext.replace(/^\./, '') : '';
  const suffix = count > 1 ? ` (x${count})` : '';
  return `${timestamp}${normalizedExt ? `.${normalizedExt}` : ''}${suffix}`;
}

export function resolveImageFileName(path?: string, fallback?: string): string {
  const raw = (path || '').trim();
  if (!raw) return fallback ?? '';
  if (raw.startsWith('images/')) {
    return raw.slice('images/'.length);
  }
  const withoutQuery = raw.split('?')[0];
  const segments = withoutQuery.split('/').filter(Boolean);
  const candidate = segments.length ? segments[segments.length - 1] : withoutQuery;
  return candidate || (fallback ?? '');
}

export function extractFilesFromClipboardData(data: DataTransfer | null | undefined, predicate?: (file: File) => boolean): File[] {
  if (!data) return [];
  const results: File[] = [];

  const pushIfAllowed = (file: File | null) => {
    if (!file) return;
    if (predicate && !predicate(file)) return;
    results.push(file);
  };

  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (item.kind === 'file') {
        pushIfAllowed(item.getAsFile());
      }
    }
  }

  if (results.length === 0 && data.files && data.files.length > 0) {
    for (let i = 0; i < data.files.length; i++) {
      pushIfAllowed(data.files[i]);
    }
  }

  return results;
}

export async function readClipboardFiles(predicate: (mime: string) => boolean, options?: { base?: string }): Promise<File[]> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    throw new Error('clipboard_not_supported');
  }

  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    const base = options?.base ?? formatTimestamp();
    let index = 0;

    for (const item of items) {
      const matchedType = item.types.find((type) => predicate(type));
      if (!matchedType) continue;
      const blob = await item.getType(matchedType);
      const ext = MIME_EXTENSION_MAP[matchedType] || inferExtension({ type: matchedType }, FALLBACK_EXTENSION);
      const name = buildDisplayName(ext, { base, index, total: items.length });
      files.push(new File([blob], name, { type: matchedType }));
      index += 1;
    }

    return files;
  } catch (error: any) {
    if (error && typeof error.name === 'string') {
      if (error.name === 'NotAllowedError') {
        throw new Error('clipboard_permission_denied');
      }
    }
    throw error;
  }
}

type FilePredicate = (file: File) => boolean;

export async function collectFilesFromItems(
  items: DataTransferItemList,
  predicate?: FilePredicate,
  options?: { requireDirectory?: boolean }
): Promise<File[]> {
  const requireDirectory = options?.requireDirectory ?? false;
  const filePromises: Promise<File[]>[] = [];
  let encounteredDirectory = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = (item as any).webkitGetAsEntry?.();

    if (entry) {
      if (entry.isDirectory) {
        encounteredDirectory = true;
        filePromises.push(traverseEntry(entry, predicate));
      } else if (entry.isFile) {
        if (requireDirectory) continue;
        filePromises.push(
          new Promise<File[]>((resolve) => {
            entry.file((file: File) => {
              resolve(applyPredicate(file, predicate));
            });
          })
        );
      }
    } else {
      const file = item.getAsFile();
      if (!file) continue;
      if (requireDirectory) {
        if (file.webkitRelativePath) {
          encounteredDirectory = true;
          filePromises.push(Promise.resolve(applyPredicateList([file], predicate)));
        }
      } else {
        filePromises.push(Promise.resolve(applyPredicateList([file], predicate)));
      }
    }
  }

  const nested = await Promise.all(filePromises);
  const flat = nested.flat();

  if (requireDirectory && !encounteredDirectory) {
    return [];
  }

  return flat;
}

function applyPredicate(file: File, predicate?: FilePredicate): File[] {
  if (predicate && !predicate(file)) return [];
  return [file];
}

function applyPredicateList(files: File[], predicate?: FilePredicate): File[] {
  if (!predicate) return files;
  return files.filter(predicate);
}

async function traverseEntry(entry: any, predicate?: FilePredicate): Promise<File[]> {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise<File[]>((resolve) => {
      entry.file((file: File) => resolve(applyPredicate(file, predicate)));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    return new Promise<File[]>((resolve) => {
      const all: File[] = [];
      const readBatch = () => {
        reader.readEntries(async (entries: any[]) => {
          if (!entries.length) {
            resolve(all);
            return;
          }
          for (const child of entries) {
            const childFiles = await traverseEntry(child, predicate);
            all.push(...childFiles);
          }
          readBatch();
        });
      };
      readBatch();
    });
  }
  return [];
}
