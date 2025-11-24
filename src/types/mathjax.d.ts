declare global {
  interface Window {
    MathJax?: {
      startup?: { promise?: Promise<unknown> };
      typesetPromise?: (elements?: any) => Promise<any>;
      texReset?: () => void;
      clearCache?: () => void;
      [key: string]: any;
    };
  }
}

export {};
