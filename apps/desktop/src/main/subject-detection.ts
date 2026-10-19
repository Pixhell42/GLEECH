import sharp from 'sharp';
import { createSubjectDetector } from './subject-model';

export const detectSubject = createSubjectDetector(sharp, () => {
  // Newer ONNX npm releases omit Darwin x64 binaries. Keep a compatible Intel
  // runtime isolated from the current Windows/Apple Silicon runtime.
  const intelMac = process.platform === 'darwin' && process.arch === 'x64';
  return intelMac ? import('onnxruntime-node-macos-x64') : import('onnxruntime-node');
});
