import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopBridge } from '../shared/image-api';

const bridge: DesktopBridge = {
  updateState: () => ipcRenderer.invoke('updates:state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  setAutomaticUpdates: (enabled) => ipcRenderer.invoke('updates:automatic', enabled),
  dismissUpdate: () => ipcRenderer.invoke('updates:dismiss'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: (id) => ipcRenderer.invoke('updates:install', id),
  acknowledgeReleaseNotes: (version) => ipcRenderer.invoke('updates:acknowledge-notes', version),
  onUpdateStateChanged: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: import('../shared/updates').UpdateState,
    ) => handler(state);
    ipcRenderer.on('updates:changed', listener);
    return () => {
      ipcRenderer.removeListener('updates:changed', listener);
    };
  },
  prepareUpdateSession: (project, documentId, options) =>
    ipcRenderer.invoke('updates:prepare-session', project, documentId, options),
  restoreUpdateSession: () => ipcRenderer.invoke('updates:restore-session'),
  finishUpdateRestore: (id) => ipcRenderer.invoke('updates:finish-restore', id),
  openAppLicenses: (kind) => ipcRenderer.invoke('updates:licenses', kind),
  renderStatus: (refresh) => ipcRenderer.invoke('render:ffmpeg-status', refresh),
  locateFfmpeg: () => ipcRenderer.invoke('render:locate-ffmpeg'),
  chooseRenderOutput: (kind, name, extension) =>
    ipcRenderer.invoke('render:choose-output', kind, name, extension),
  defaultRenderFolder: () => ipcRenderer.invoke('render:default-folder'),
  renderOutputExists: (path) => ipcRenderer.invoke('render:output-exists', path),
  beginRender: (spec) => ipcRenderer.invoke('render:begin', spec),
  renderMemoryBudget: () => ipcRenderer.invoke('render:memory-budget'),
  renderResumeFrames: (id) => ipcRenderer.invoke('render:resume-frames', id),
  renderFrame: (id, frame, original) => ipcRenderer.invoke('render:frame', id, frame, original),
  finishRender: (id) => ipcRenderer.invoke('render:finish', id),
  cancelRender: (id) => ipcRenderer.invoke('render:cancel', id),
  revealRender: (path) => ipcRenderer.invoke('render:reveal', path),
  chooseFile: () => ipcRenderer.invoke('file:choose'),
  selectDroppedFile: (file) => ipcRenderer.invoke('file:drop', webUtils.getPathForFile(file)),
  openVideo: (selectionId) => ipcRenderer.invoke('media:open-video', selectionId),
  openAudio: () => ipcRenderer.invoke('media:open-audio'),
  registerMedia: (path, kind) => ipcRenderer.invoke('media:register', path, kind),
  readAudioSamples: (id) => ipcRenderer.invoke('media:audio-samples', id),
  openVideoReader: (id, options) => ipcRenderer.invoke('media:reader-open', id, options),
  readVideoFrame: (id) => ipcRenderer.invoke('media:reader-next', id),
  closeVideoReader: (id) => ipcRenderer.invoke('media:reader-close', id),
  videoFrameAt: (id, t, max) => ipcRenderer.invoke('media:frame-at', id, t, max),
  readMcpImageData: (id) => ipcRenderer.invoke('mcp:read-image-data', id),
  mcpFolderOperation: (id) => ipcRenderer.invoke('mcp:folder-operation', id),
  preflightMcpBatch: (id) => ipcRenderer.invoke('mcp:batch-preflight', id),
  readMcpBatch: (id, index) => ipcRenderer.invoke('mcp:batch-read', id, index),
  writeMcpBatch: (id, index, pixels) => ipcRenderer.invoke('mcp:batch-write', id, index, pixels),
  cleanupMcpBatch: (id) => ipcRenderer.invoke('mcp:batch-cleanup', id),
  analyzeMcpImage: (id, sourceId) => ipcRenderer.invoke('mcp:analyze', id, sourceId),
  validateMcpRecipes: (id) => ipcRenderer.invoke('mcp:validate-recipes', id),
  mcpPresetOperation: (id, payload) => ipcRenderer.invoke('mcp:preset-operation', id, payload),
  addMcpFolder: (kind) => ipcRenderer.invoke('mcp:add-folder', kind),
  removeMcpFolder: (id) => ipcRenderer.invoke('mcp:remove-folder', id),
  readMcpFile: (id) => ipcRenderer.invoke('mcp:read-file', id),
  checkMcpAccess: (id) => ipcRenderer.invoke('mcp:check-access', id),
  writeMcpFile: (id, payload) => ipcRenderer.invoke('mcp:write-file', id, payload),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  setMcpClipboardAllowed: (allowed) => ipcRenderer.invoke('mcp:set-clipboard', allowed),
  copyMcpImage: (id, sourceId, pixels) =>
    ipcRenderer.invoke('mcp:copy-image', id, sourceId, pixels),
  testMcpConnection: (client) => ipcRenderer.invoke('mcp:test-connection', client),
  setMcpMode: (mode) => ipcRenderer.invoke('mcp:set-mode', mode),
  copyMcpConfiguration: (client) => ipcRenderer.invoke('mcp:copy-config', client),
  getMcpSetupPrompt: (client) => ipcRenderer.invoke('mcp:setup-prompt', client),
  copyMcpSetupPrompt: (client) => ipcRenderer.invoke('mcp:copy-setup-prompt', client),
  onMcpStatusChanged: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: import('@gleech/mcp/protocol').McpStatus,
    ) => handler(status);
    ipcRenderer.on('mcp:status-changed', listener);
    return () => ipcRenderer.removeListener('mcp:status-changed', listener);
  },
  onMcpRequest: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: import('@gleech/mcp/protocol').McpDispatch,
    ) => handler(request);
    ipcRenderer.on('mcp:request', listener);
    ipcRenderer.send('mcp:ready');
    return () => ipcRenderer.removeListener('mcp:request', listener);
  },
  replyMcp: (id, result) => ipcRenderer.send('mcp:reply', id, result),
  onMcpCancelled: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => handler(id);
    ipcRenderer.on('mcp:cancel', listener);
    return () => ipcRenderer.removeListener('mcp:cancel', listener);
  },
  feedbackStatus: () => ipcRenderer.invoke('feedback:status'),
  startFeedbackSignIn: () => ipcRenderer.invoke('feedback:sign-in'),
  pollFeedbackSignIn: () => ipcRenderer.invoke('feedback:poll'),
  cancelFeedbackSignIn: () => ipcRenderer.invoke('feedback:cancel-sign-in'),
  copyFeedbackSignInCode: () => ipcRenderer.invoke('feedback:copy-code'),
  openFeedbackSignIn: () => ipcRenderer.invoke('feedback:open-sign-in'),
  signOutFeedback: () => ipcRenderer.invoke('feedback:sign-out'),
  submitFeedback: (draft) => ipcRenderer.invoke('feedback:submit', draft),
  openFeedbackIssue: (number) => ipcRenderer.invoke('feedback:open-issue', number),
  openSupportLink: (id) => ipcRenderer.invoke('support:open', id),
  copySupportDestination: (id) => ipcRenderer.invoke('support:copy', id),
  copyAppVersion: () => ipcRenderer.invoke('app:copy-version'),
  recompressJpeg: (image, options) => ipcRenderer.invoke('image:jpeg-recompress', image, options),
  windowState: () => ipcRenderer.invoke('window:state'),
  onWindowStateChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }) =>
      handler(state);
    ipcRenderer.on('window:state-changed', listener);
    return () => ipcRenderer.removeListener('window:state-changed', listener);
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  listShaders: () => ipcRenderer.invoke('shader:list'),
  openShader: () => ipcRenderer.invoke('shader:open'),
  fetchShader: (url) => ipcRenderer.invoke('shader:fetch', url),
  storeShader: (pkg, thumbnail) => ipcRenderer.invoke('shader:store', pkg, thumbnail),
  deleteShader: (id) => ipcRenderer.invoke('shader:delete', id),
  openCredit: (url) => ipcRenderer.invoke('shader:credit', url),
  shaderPreviewSource: (id, recipe) => ipcRenderer.invoke('shader:preview-source', id, recipe),
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chromium: process.versions.chrome ?? '',
  },
  openImage: (selectionId) => ipcRenderer.invoke('image:open', selectionId),
  openSampleImage: () => ipcRenderer.invoke('image:open-sample'),
  layerImageFromSource: (id) => ipcRenderer.invoke('image:layer-from-source', id),
  openLayerImage: (purpose) => ipcRenderer.invoke('image:open-layer', purpose),
  listDepthMaps: () => ipcRenderer.invoke('depth-maps:list'),
  chooseDepthMap: (id) => ipcRenderer.invoke('depth-maps:choose', id),
  listVectorMaps: () => ipcRenderer.invoke('vector-maps:list'),
  chooseVectorMap: (id) => ipcRenderer.invoke('vector-maps:choose', id),
  decodeLayerImage: (image) => ipcRenderer.invoke('image:decode-layer', image),
  importFile: (file) => ipcRenderer.invoke('image:drop', webUtils.getPathForFile(file)),
  pasteImage: () => ipcRenderer.invoke('image:paste'),
  copyImage: (id, pixels) => ipcRenderer.invoke('image:copy', id, pixels),
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (data) => ipcRenderer.invoke('settings:write', data),
  originalPixels: (id) => ipcRenderer.invoke('image:original', id),
  subjectMask: (id) => ipcRenderer.invoke('image:subject', id),
  savePng: (id, pixels) => ipcRenderer.invoke('image:save-png', id, pixels),
  saveImage: (id, pixels, options, name) =>
    ipcRenderer.invoke('image:save', id, pixels, options, name),
  presetThumbnails: (id, recipe) => ipcRenderer.invoke('preset:thumbnails', id, recipe),
  storePreset: (recipe, name, thumbnail, choice) =>
    ipcRenderer.invoke('preset:store', recipe, name, thumbnail, choice),
  editPreset: (id, name, thumbnail, choice) =>
    ipcRenderer.invoke('preset:edit', id, name, thumbnail, choice),
  openProject: (selectionId) => ipcRenderer.invoke('project:open', selectionId),
  listRecentProjects: () => ipcRenderer.invoke('project:recents'),
  openRecentProject: (id) => ipcRenderer.invoke('project:open-recent', id),
  clearRecentProjects: () => ipcRenderer.invoke('project:clear-recents'),
  saveProject: (project, documentId, saveAs) =>
    ipcRenderer.invoke('project:save', project, documentId, saveAs),
  releaseImage: (id) => ipcRenderer.invoke('image:release', id),
  captureImage: (id, pixels, name) => ipcRenderer.invoke('image:capture', id, pixels, name),
  importPixels: (width, height, pixels, name) =>
    ipcRenderer.invoke('image:from-pixels', width, height, pixels, name),
  listPresets: () => ipcRenderer.invoke('preset:list'),
  savePreset: (id, pixels, recipe, name) =>
    ipcRenderer.invoke('preset:save', id, pixels, recipe, name),
  renamePreset: (id, name) => ipcRenderer.invoke('preset:rename', id, name),
  deletePreset: (id) => ipcRenderer.invoke('preset:delete', id),
  importPreset: () => ipcRenderer.invoke('preset:import'),
  exportPreset: (id) => ipcRenderer.invoke('preset:export', id),
  confirmDiscard: (name) => ipcRenderer.invoke('document:confirm-discard', name),
  confirmAction: (title, message, detail, action) =>
    ipcRenderer.invoke('document:confirm-action', title, message, detail, action),
  onCloseRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('document:close-requested', listener);
    ipcRenderer.send('document:ready');
    return () => {
      ipcRenderer.removeListener('document:close-requested', listener);
    };
  },
  resolveClose: (allow) => ipcRenderer.invoke('document:resolve-close', allow),
  requestClose: () => ipcRenderer.invoke('document:request-close'),
  mcpRenderTarget: (id) => ipcRenderer.invoke('mcp:render-target', id),
};
contextBridge.exposeInMainWorld('gleech', bridge);
