import type {
  ImageSource,
  SubjectMask,
  ProjectState,
  EffectPreset,
  PresetRecipe,
  LayerImage,
} from '@gleech/project-model';
import type { SettingsClipboard } from '@gleech/command-service';
import type { JpegPassOptions } from '@gleech/effects';
import type { ShaderPackage } from '@gleech/project-model/shader-package';

export interface LibraryShader {
  id: string;
  package: ShaderPackage;
  thumbnail: string;
}
export interface ShaderPreviewSource {
  image: PixelImage;
  reference: { width: number; height: number };
  subjectMask?: SubjectMask;
}

export interface StarterMapItem {
  id: string;
  name: string;
  category: string;
  description: string;
  width: number;
  height: number;
  thumbnail: string;
}
export type DepthMapItem = StarterMapItem;

export interface LibraryPreset extends EffectPreset {
  readonly builtIn?: boolean;
  readonly description?: string;
}

export interface PixelImage {
  width: number;
  height: number;
  pixels: ArrayBuffer;
}
export interface ImageExportOptions {
  format: 'png' | 'jpeg' | 'webp' | 'tiff';
  quality?: number;
}
export interface PresetThumbnails {
  image: string | null;
  statue: string;
}

export interface ImportedImage {
  source: ImageSource;
  preview: PixelImage;
  thumbnail: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ProjectDocument {
  id: string;
  name: string;
  recentWarning?: string;
}
export interface RecentProject {
  id: string;
  name: string;
  path: string;
  lastUsed: string;
}
export interface OpenedProject {
  project: ProjectState;
  image: ImportedImage;
  images: readonly ImportedImage[];
  document: ProjectDocument;
}

export interface WindowState {
  maximized: boolean;
}

export interface DesktopBridge {
  // Timeline rendering (main/render-service.ts)
  renderStatus(refresh?: boolean): Promise<Result<import('./render').FfmpegStatus>>;
  locateFfmpeg(): Promise<Result<import('./render').FfmpegStatus | null>>;
  chooseRenderOutput(
    kind: 'file' | 'folder',
    defaultName: string,
    extension: string,
  ): Promise<Result<string | null>>;
  defaultRenderFolder(): Promise<Result<string>>;
  beginRender(spec: import('./render').RenderJobSpec): Promise<Result<string>>;
  renderFrame(
    jobId: string,
    frame: import('./render').RenderFrame,
    original?: import('./render').RenderFrame,
  ): Promise<Result<void>>;
  finishRender(jobId: string): Promise<Result<import('./render').RenderResult>>;
  cancelRender(jobId: string): Promise<Result<void>>;
  revealRender(path: string): Promise<Result<void>>;
  // Timeline media (main/media-service.ts)
  openVideo(): Promise<
    Result<import('./render').OpenedMedia<import('./render').VideoProbe> | null>
  >;
  openAudio(): Promise<
    Result<import('./render').OpenedMedia<import('./render').AudioProbe> | null>
  >;
  /** Re-open media referenced by a saved project. */
  registerMedia(
    path: string,
    kind: 'video' | 'audio',
  ): Promise<
    Result<
      import('./render').OpenedMedia<import('./render').VideoProbe | import('./render').AudioProbe>
    >
  >;
  /** Mono float32 samples for analysis. */
  readAudioSamples(mediaId: string): Promise<Result<{ sampleRate: number; samples: ArrayBuffer }>>;
  openVideoReader(
    mediaId: string,
    options: { start: number; fps: number; count: number; width: number; height: number },
  ): Promise<Result<string>>;
  readVideoFrame(readerId: string): Promise<Result<import('./render').RenderFrame | null>>;
  closeVideoReader(readerId: string): Promise<Result<void>>;
  /** One decoded frame, for formats the preview player cannot decode. */
  videoFrameAt(
    mediaId: string,
    t: number,
    maxDimension: number,
  ): Promise<Result<import('./render').RenderFrame>>;

  readMcpImageData(dispatchId: string): Promise<Result<{ kind: 'image'; image: ImportedImage }>>;
  mcpFolderOperation(
    dispatchId: string,
  ): Promise<{ canceled: boolean; status: import('@gleech/mcp/protocol').McpStatus }>;
  preflightMcpBatch(dispatchId: string): Promise<Result<void>>;
  readMcpBatch(dispatchId: string, index: number): Promise<Result<ImportedImage>>;
  writeMcpBatch(
    dispatchId: string,
    index: number,
    pixels: ArrayBuffer,
  ): Promise<Result<{ path: string; width: number; height: number; format: string }>>;
  cleanupMcpBatch(dispatchId: string): Promise<Result<void>>;
  analyzeMcpImage(dispatchId: string, sourceId: string): Promise<Result<Record<string, unknown>>>;
  validateMcpRecipes(dispatchId: string): Promise<Result<void>>;
  mcpPresetOperation(
    dispatchId: string,
    payload?: { recipe?: PresetRecipe; thumbnail?: string },
  ): Promise<Result<{ preset?: EffectPreset; path?: string }>>;
  addMcpFolder(
    kind: 'imports' | 'projects' | 'exports',
  ): Promise<import('@gleech/mcp/protocol').McpStatus>;
  removeMcpFolder(id: string): Promise<import('@gleech/mcp/protocol').McpStatus>;
  readMcpFile(
    dispatchId: string,
  ): Promise<
    Result<({ kind: 'project' } & OpenedProject) | { kind: 'image'; image: ImportedImage }>
  >;
  checkMcpAccess(dispatchId: string): Promise<Result<void>>;
  writeMcpFile(
    dispatchId: string,
    payload: { project?: ProjectState; sourceId?: string; pixels?: ArrayBuffer },
  ): Promise<
    Result<{
      path: string;
      document?: ProjectDocument;
      format?: string;
      width?: number;
      height?: number;
    }>
  >;
  mcpStatus(): Promise<import('@gleech/mcp/protocol').McpStatus>;
  setMcpClipboardAllowed(allowed: boolean): Promise<import('@gleech/mcp/protocol').McpStatus>;
  copyMcpImage(dispatchId: string, sourceId: string, pixels: ArrayBuffer): Promise<Result<void>>;
  testMcpConnection(
    client?: import('./mcp-clients').McpClientId,
  ): Promise<{ server: string; tools: number; message: string }>;
  setMcpMode(
    mode: import('@gleech/mcp/protocol').McpMode,
  ): Promise<import('@gleech/mcp/protocol').McpStatus>;
  copyMcpConfiguration(client?: import('./mcp-clients').McpClientId): Promise<void>;
  getMcpSetupPrompt(client?: import('./mcp-clients').McpClientId): Promise<string>;
  copyMcpSetupPrompt(client?: import('./mcp-clients').McpClientId): Promise<void>;
  onMcpStatusChanged(
    handler: (status: import('@gleech/mcp/protocol').McpStatus) => void,
  ): () => void;
  onMcpRequest(handler: (request: import('@gleech/mcp/protocol').McpDispatch) => void): () => void;
  replyMcp(id: string, result: import('@gleech/mcp/protocol').McpReply): void;
  onMcpCancelled(handler: (id: string) => void): () => void;
  feedbackStatus(): Promise<Result<import('./feedback').FeedbackStatus>>;
  startFeedbackSignIn(): Promise<Result<import('./feedback').FeedbackSignIn>>;
  pollFeedbackSignIn(): Promise<Result<import('./feedback').FeedbackSignInProgress>>;
  cancelFeedbackSignIn(): Promise<Result<void>>;
  copyFeedbackSignInCode(): Promise<Result<void>>;
  openFeedbackSignIn(): Promise<Result<void>>;
  signOutFeedback(): Promise<Result<void>>;
  submitFeedback(
    draft: import('./feedback').FeedbackDraft,
  ): Promise<Result<import('./feedback').FeedbackReceipt>>;
  openFeedbackIssue(number: number): Promise<Result<void>>;
  openSupportLink(id: import('./support').SupportLinkId): Promise<Result<void>>;
  copySupportDestination(id: import('./support').PaymentId): Promise<Result<void>>;
  copyAppVersion(): Promise<Result<void>>;
  recompressJpeg(image: PixelImage, options: JpegPassOptions): Promise<Result<ArrayBuffer>>;
  windowState(): Promise<WindowState>;
  onWindowStateChanged(handler: (state: WindowState) => void): () => void;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  listShaders(): Promise<Result<readonly LibraryShader[]>>;
  openShader(): Promise<Result<ShaderPackage | null>>;
  fetchShader(url: string): Promise<Result<ShaderPackage>>;
  storeShader(pkg: ShaderPackage, thumbnail: string): Promise<Result<LibraryShader>>;
  deleteShader(id: string): Promise<Result<void>>;
  openCredit(url: string): Promise<Result<void>>;
  shaderPreviewSource(
    id: string | null,
    recipe: PresetRecipe,
  ): Promise<Result<ShaderPreviewSource>>;
  platform: string;
  versions: { electron: string; chromium: string };
  openImage(): Promise<Result<ImportedImage | null>>;
  openSampleImage(): Promise<Result<ImportedImage>>;
  layerImageFromSource(id: string): Promise<Result<LayerImage>>;
  openLayerImage(
    purpose?: 'solid' | 'depth' | 'reference' | 'vector',
  ): Promise<Result<LayerImage | null>>;
  listDepthMaps(): Promise<Result<readonly DepthMapItem[]>>;
  chooseDepthMap(id: string): Promise<Result<LayerImage>>;
  listVectorMaps(): Promise<Result<readonly StarterMapItem[]>>;
  chooseVectorMap(id: string): Promise<Result<LayerImage>>;
  decodeLayerImage(image: LayerImage): Promise<Result<PixelImage>>;
  importFile(file: File): Promise<Result<ImportedImage>>;
  pasteImage(): Promise<Result<ImportedImage>>;
  copyImage(id: string, pixels: ArrayBuffer): Promise<Result<void>>;
  readSettings(): Promise<Result<SettingsClipboard | null>>;
  writeSettings(data: SettingsClipboard): Promise<Result<void>>;
  originalPixels(id: string): Promise<Result<PixelImage>>;
  subjectMask(id: string): Promise<Result<SubjectMask>>;
  savePng(id: string, pixels: ArrayBuffer): Promise<Result<string | null>>;
  saveImage(
    id: string,
    pixels: ArrayBuffer,
    options: ImageExportOptions,
    name: string,
  ): Promise<Result<string | null>>;
  presetThumbnails(
    sourceId: string | null,
    recipe: PresetRecipe,
  ): Promise<Result<PresetThumbnails>>;
  storePreset(
    recipe: PresetRecipe,
    name: string,
    thumbnail: string,
    choice: 'image' | 'statue',
  ): Promise<Result<EffectPreset>>;
  editPreset(
    id: string,
    name: string,
    thumbnail: string,
    choice: 'image' | 'statue',
  ): Promise<Result<EffectPreset>>;
  openProject(): Promise<Result<OpenedProject | null>>;
  listRecentProjects(): Promise<Result<readonly RecentProject[]>>;
  openRecentProject(id: string): Promise<Result<OpenedProject>>;
  clearRecentProjects(): Promise<Result<void>>;
  saveProject(
    project: ProjectState,
    documentId: string | null,
    saveAs: boolean,
  ): Promise<Result<ProjectDocument | null>>;
  releaseImage(id: string): Promise<void>;
  captureImage(sourceId: string, pixels: ArrayBuffer, name: string): Promise<Result<ImportedImage>>;
  /** Register decoded RGBA pixels (a video poster frame) as a new source image. */
  importPixels(
    width: number,
    height: number,
    pixels: ArrayBuffer,
    name: string,
  ): Promise<Result<ImportedImage>>;
  listPresets(): Promise<Result<readonly LibraryPreset[]>>;
  savePreset(
    sourceId: string,
    pixels: ArrayBuffer,
    recipe: PresetRecipe,
    name: string,
  ): Promise<Result<EffectPreset>>;
  renamePreset(id: string, name: string): Promise<Result<EffectPreset>>;
  deletePreset(id: string): Promise<Result<void>>;
  importPreset(): Promise<Result<EffectPreset | null>>;
  exportPreset(id: string): Promise<Result<string | null>>;
  confirmDiscard(name: string): Promise<Result<'save' | 'discard' | 'cancel'>>;
  onCloseRequested(handler: () => void): () => void;
  resolveClose(allow: boolean): Promise<void>;
  requestClose(): Promise<void>;
  mcpRenderTarget(dispatchId: string): Promise<Result<string>>;
}

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
