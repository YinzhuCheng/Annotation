import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

const collectFilesFromDataTransfer = (data: DataTransfer | null | undefined): File[] => {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null) => {
    if (!file) return;
    const key = `${file.name}::${file.size}::${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  if (data.files) {
    for (const file of Array.from(data.files)) {
      push(file);
    }
  }

  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue;
      push(item.getAsFile());
    }
  }

  return files;
};

export const extractClipboardFiles = (
  event: ReactClipboardEvent | ClipboardEvent,
  filter?: (file: File) => boolean
): File[] => {
  const clipboardData = 'clipboardData' in event ? event.clipboardData : null;
  const files = collectFilesFromDataTransfer(clipboardData);
  return filter ? files.filter(filter) : files;
};

export const preventPrintableInput = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
  }
};
