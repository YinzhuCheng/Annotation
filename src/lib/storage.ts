export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
    } else {
    return { usage: 0, quota: 0 };
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
