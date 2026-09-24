/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PREVIEW?: string;
  /** File name of the gzipped English OCR model under /ocr/. */
  readonly VITE_OCR_MODEL_FILE?: string;
}
