import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, link, unlink } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createCommandService, type CommandService } from '@gleech/command-service';
import {
  createProject,
  projectSources,
  type ImageSource,
  type ProjectState,
  type SubjectMask,
} from '@gleech/project-model';
import { createSubjectDetector } from '../main/subject-model';
import { decodeProject, encodeProject, type SavedAsset } from '../main/project-file';
import { decodeImageBytes, encodeImage, type RgbaImage } from './codec';
import { draftFor, renderHeadless, type HeadlessRenderResult } from './engine';
import { loadOnnx, loadSharp, sampleImagePath, subjectModelPath } from './runtime';
import { resolveTimelineMedia } from './timeline-project';

interface Asset {
  png?: ArrayBuffer;
  image?: RgbaImage;
  subject?: Promise<SubjectMask>;
}

let detector: ReturnType<typeof createSubjectDetector> | null = null;
function detectSubject(image: RgbaImage): Promise<SubjectMask> {
  const sharp = loadSharp();
  if (!sharp) return Promise.reject(new Error('Subject detection needs Sharp. Run pnpm install.'));
  detector ??= createSubjectDetector(sharp, loadOnnx);
  return detector(image, subjectModelPath());
}

const projectName = (path: string) => basename(path, extname(path)) || 'Untitled';

/**
 * One editable GLEECH document: a project state with full command history plus
 * the decoded source pixels and embedded assets needed to render or save it.
 */
export class Session {
  readonly service: CommandService;
  path: string | null;
  dirty = false;
  private readonly assets = new Map<string, Asset>();
  private drafts = new Map<number, { source: RgbaImage; draft: Promise<RgbaImage> }>();

  private constructor(project: ProjectState, assets: Map<string, Asset>, path: string | null) {
    this.service = createCommandService(project);
    this.path = path;
    for (const [id, asset] of assets) this.assets.set(id, asset);
    this.service.subscribe(() => {
      this.dirty = true;
    });
  }

  static async fromImageBytes(bytes: Uint8Array, name: string): Promise<Session> {
    const decoded = await decodeImageBytes(bytes);
    const source: ImageSource = {
      id: randomUUID(),
      name,
      width: decoded.image.width,
      height: decoded.image.height,
      format: decoded.format,
      hasAlpha: decoded.hasAlpha,
    };
    const session = new Session(
      createProject(name),
      new Map([[source.id, { image: decoded.image }]]),
      null,
    );
    session.service.setSource(source);
    session.dirty = false;
    return session;
  }

  static async open(path: string): Promise<Session> {
    const bytes = await readFile(path);
    if (bytes.subarray(0, 6).toString('latin1') === 'GLEECH')
      return Session.fromProjectBytes(bytes, path);
    return Session.fromImageBytes(bytes, basename(path));
  }

  static async sample(): Promise<Session> {
    return Session.fromImageBytes(await readFile(sampleImagePath()), 'statue.png');
  }

  static fromProjectBytes(bytes: Buffer, path: string | null): Session {
    const { project, assets } = decodeProject(bytes);
    const map = new Map<string, Asset>();
    for (const [id, saved] of assets)
      map.set(id, {
        png: saved.png,
        ...(saved.subject ? { subject: Promise.resolve(saved.subject) } : {}),
      });
    const session = new Session(path ? resolveTimelineMedia(project, path) : project, map, path);
    session.dirty = false;
    return session;
  }

  get state(): ProjectState {
    return this.service.getState();
  }

  get name(): string {
    return this.state.name || (this.path ? projectName(this.path) : 'Untitled');
  }

  private asset(id: string): Asset {
    let asset = this.assets.get(id);
    if (!asset) this.assets.set(id, (asset = {}));
    return asset;
  }

  async sourceImage(sourceId = this.state.source?.id): Promise<RgbaImage> {
    if (!sourceId) throw new Error('This project has no source image.');
    const asset = this.asset(sourceId);
    if (!asset.image) {
      if (!asset.png) throw new Error('The project source image is missing.');
      asset.image = (await decodeImageBytes(new Uint8Array(asset.png))).image;
    }
    return asset.image;
  }

  subject(sourceId = this.state.source?.id): Promise<SubjectMask> {
    if (!sourceId) return Promise.reject(new Error('Open an image first.'));
    const asset = this.asset(sourceId);
    if (!asset.subject) {
      asset.subject = this.sourceImage(sourceId).then(detectSubject);
      asset.subject.catch(() => delete asset.subject);
    }
    return asset.subject;
  }

  /** Full-resolution render, identical in recipe semantics to a desktop export. */
  async render(isCancelled?: () => boolean): Promise<HeadlessRenderResult> {
    const state = this.state;
    return renderHeadless({
      source: await this.sourceImage(state.source?.id),
      effects: state.effects,
      masterSeed: state.masterSeed,
      subject: () => this.subject(state.source?.id),
      ...(isCancelled ? { isCancelled } : {}),
    });
  }

  /** Reduced draft render that keeps field placement aligned with the full image. */
  async preview(maxDimension: number, isCancelled?: () => boolean): Promise<HeadlessRenderResult> {
    const state = this.state;
    const source = await this.sourceImage(state.source?.id);
    let cached = this.drafts.get(maxDimension);
    if (!cached || cached.source !== source) {
      cached = { source, draft: draftFor(source, maxDimension) };
      this.drafts.set(maxDimension, cached);
      if (this.drafts.size > 3) this.drafts.delete(this.drafts.keys().next().value!);
    }
    return renderHeadless({
      source,
      draftSource: await cached.draft,
      previewMaxDimension: maxDimension,
      effects: state.effects,
      masterSeed: state.masterSeed,
      subject: () => this.subject(state.source?.id),
      ...(isCancelled ? { isCancelled } : {}),
    });
  }

  /** Save as a portable .gleech project, atomically. */
  async save(path: string, overwrite = false): Promise<void> {
    const project = this.state;
    const saved = new Map<string, SavedAsset>();
    for (const source of projectSources(project)) {
      const asset = this.asset(source.id);
      if (!asset.png) {
        if (!asset.image) throw new Error(`Project image ${source.name} is missing.`);
        asset.png = Uint8Array.from(await encodeImage(asset.image, 'png')).buffer;
      }
      let subject: SubjectMask | undefined;
      if (asset.subject) subject = await asset.subject.catch(() => undefined);
      saved.set(source.id, { png: asset.png, ...(subject ? { subject } : {}) });
    }
    const bytes = encodeProject(project, saved);
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      if (overwrite) await rename(temporary, path);
      else await link(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    this.path = path;
    if (this.state === project) this.dirty = false;
  }
}
