export const formatTimestampName = (options?: { extension?: string; prefix?: string }) => {
  const { extension, prefix } = options || {};
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const base = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const normalizedExt = extension ? extension.replace(/^\./, '') : '';
  const prefixPart = prefix ? `${prefix}-` : '';
  const extPart = normalizedExt ? `.${normalizedExt}` : '';
  return `${prefixPart}${base}${extPart}`;
};

export const cloneFileWithName = (file: File, name: string) => {
  return new File([file], name, { type: file.type, lastModified: Date.now() });
};

export const cloneFileWithTimestamp = (
  file: File,
  options?: { prefix?: string; extension?: string; fallbackExtension?: string }
) => {
  const extFromOptions = options?.extension?.replace(/^\./, '') || '';
  const extFromName = (() => {
    const parts = file.name?.split('.') || [];
    if (parts.length > 1) {
      const ext = parts.pop();
      return ext ? ext : '';
    }
    return '';
  })();
  const extFromType = (() => {
    if (!file.type) return '';
    const match = /\/([a-z0-9.+-]+)$/i.exec(file.type);
    return match ? match[1] : '';
  })();
  const effectiveExtension = extFromOptions || extFromName || extFromType || options?.fallbackExtension || '';
  const generated = formatTimestampName({ prefix: options?.prefix, extension: effectiveExtension });
  return cloneFileWithName(file, generated);
};
