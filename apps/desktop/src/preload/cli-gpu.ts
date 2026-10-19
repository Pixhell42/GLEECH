import { contextBridge, ipcRenderer } from 'electron';
import type { GpuBridge } from '../shared/cli-gpu-api';
const bridge: GpuBridge = {
  onRequest(callback) {
    ipcRenderer.on('cli-gpu:request', (_event, request) => callback(request));
  },
  reply(reply) {
    ipcRenderer.send('cli-gpu:reply', reply);
  },
  ready(capabilities) {
    ipcRenderer.send('cli-gpu:ready', capabilities);
  },
};
contextBridge.exposeInMainWorld('gleechGpu', bridge);
