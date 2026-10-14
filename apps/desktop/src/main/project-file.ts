import { createHash } from 'node:crypto';
import { FILE_APPLICATION } from './file-metadata';
import {
  assertProject,
  projectSources,
  PROJECT_SCHEMA_VERSION,
  type ProjectState,
  type SubjectMask,
} from '@gleech/project-model';

const signature = Buffer.from('GLEECH02');
const legacySignature = Buffer.from('GLEECH01');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxRecipeBytes = 32 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 300 * 1024 * 1024;
export const MAX_PROJECT_PIXELS = 128 * 1024 * 1024;
export interface SavedAsset {
  png: ArrayBuffer;
  subject?: SubjectMask;
}
interface AssetEntry {
  id: string;
  pngBytes: number;
  pngHash: string;
  subject?: { width: number; height: number; bytes: number; hash: string };
}
const hash = (bytes: ArrayBuffer | Buffer) =>
  createHash('sha256')
    .update(bytes instanceof ArrayBuffer ? Buffer.from(bytes) : bytes)
    .digest('hex');
function checkBudget(project: ProjectState): void {
  if (
    projectSources(project).reduce((sum, source) => sum + source.width * source.height, 0) >
    MAX_PROJECT_PIXELS
  )
    throw new Error('Project assets exceed the 128 megapixel total limit.');
}
function checkSubject(mask: SubjectMask): void {
  if (
    !Number.isSafeInteger(mask.width) ||
    !Number.isSafeInteger(mask.height) ||
    mask.width < 1 ||
    mask.height < 1 ||
    mask.width > 1024 ||
    mask.height > 1024 ||
    !(mask.values instanceof ArrayBuffer) ||
    mask.values.byteLength !== mask.width * mask.height
  )
    throw new Error('The project subject mask is damaged.');
}
export function encodeProject(
  project: ProjectState,
  assets: ReadonlyMap<string, SavedAsset>,
): Buffer {
  assertProject(project);
  if (!project.source) throw new Error('Open an image before saving a project.');
  checkBudget(project);
  const entries: AssetEntry[] = [];
  const payloads: Buffer[] = [];
  for (const source of projectSources(project)) {
    const asset = assets.get(source.id);
    if (!asset || !Buffer.from(asset.png).subarray(0, 8).equals(pngSignature))
      throw new Error('Project image is missing or damaged.');
    const entry: AssetEntry = {
      id: source.id,
      pngBytes: asset.png.byteLength,
      pngHash: hash(asset.png),
    };
    payloads.push(Buffer.from(asset.png));
    if (asset.subject) {
      checkSubject(asset.subject);
      entry.subject = {
        width: asset.subject.width,
        height: asset.subject.height,
        bytes: asset.subject.values.byteLength,
        hash: hash(asset.subject.values),
      };
      payloads.push(Buffer.from(asset.subject.values));
    }
    entries.push(entry);
  }
  const recipe = Buffer.from(
    JSON.stringify({ rendererVersion: 1, application: FILE_APPLICATION, project, assets: entries }),
  );
  if (
    recipe.length > maxRecipeBytes ||
    recipe.length + payloads.reduce((sum, bytes) => sum + bytes.length, 12) > MAX_PROJECT_BYTES
  )
    throw new Error('This project exceeds the 300 MB file limit.');
  const header = Buffer.alloc(12);
  signature.copy(header);
  header.writeUInt32LE(recipe.length, 8);
  return Buffer.concat([header, recipe, ...payloads]);
}
export function decodeProject(bytes: Buffer): {
  project: ProjectState;
  assets: Map<string, SavedAsset>;
} {
  const legacy = bytes.subarray(0, 8).equals(legacySignature);
  if (
    bytes.length < 13 ||
    bytes.length > MAX_PROJECT_BYTES ||
    (!legacy && !bytes.subarray(0, 8).equals(signature))
  )
    throw new Error('Choose a valid GLEECH project (.gleech).');
  const length = bytes.readUInt32LE(8);
  if (!length || length > (legacy ? 1024 * 1024 : maxRecipeBytes) || length + 12 >= bytes.length)
    throw new Error('The project file is incomplete or damaged.');
  let document;
  try {
    document = JSON.parse(bytes.subarray(12, 12 + length).toString('utf8'));
  } catch {
    throw new Error('The project recipe is damaged.');
  }
  if (!document || document.rendererVersion !== 1)
    throw new Error('Unsupported project renderer version.');
  if (legacy) {
    if (document.project?.schemaVersion !== 1) throw new Error('Unsupported project version.');
    document.project = {
      ...document.project,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      origin: document.project.source,
      sourceSnapshotId: null,
      snapshots: [],
    };
  }
  assertProject(document.project);
  const project = document.project;
  if (!project.source) throw new Error('Project image is missing.');
  checkBudget(project);
  const assets = new Map<string, SavedAsset>();
  if (legacy) {
    const png = bytes.subarray(12 + length);
    if (!png.subarray(0, 8).equals(pngSignature))
      throw new Error('The project source image is damaged.');
    assets.set(project.source.id, { png: Uint8Array.from(png).buffer });
    return { project, assets };
  }
  const sources = projectSources(project);
  if (!Array.isArray(document.assets) || document.assets.length !== sources.length)
    throw new Error('The project assets are incomplete.');
  let offset = 12 + length;
  function take(size: number, expectedHash: string): ArrayBuffer {
    if (!Number.isSafeInteger(size) || size < 1 || offset + size > bytes.length)
      throw new Error('The project assets are incomplete or damaged.');
    const payload = bytes.subarray(offset, offset + size);
    if (typeof expectedHash !== 'string' || hash(payload) !== expectedHash)
      throw new Error('The project asset checksum is damaged.');
    offset += size;
    return Uint8Array.from(payload).buffer;
  }
  for (const entry of document.assets as AssetEntry[]) {
    if (!entry || !sources.some((source) => source.id === entry.id) || assets.has(entry.id))
      throw new Error('Invalid project asset references.');
    const png = take(entry.pngBytes, entry.pngHash);
    if (!Buffer.from(png).subarray(0, 8).equals(pngSignature))
      throw new Error('The project source image is damaged.');
    const asset: SavedAsset = { png };
    if (entry.subject) {
      asset.subject = {
        width: entry.subject.width,
        height: entry.subject.height,
        values: take(entry.subject.bytes, entry.subject.hash),
      };
      checkSubject(asset.subject);
    }
    assets.set(entry.id, asset);
  }
  if (offset !== bytes.length) throw new Error('The project contains unexpected trailing data.');
  return { project, assets };
}
