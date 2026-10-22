import { lstat, link, mkdir, mkdtemp, readdir, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { RenderCancelledError } from '@gleech/effects';
import { createRenderJobs, safeName } from '../main/render-jobs';
import { runTimelineRender, type TimelineRunOptions } from '../shared/timeline-runner';
import { cliTimelinePlan } from './timeline-plan';
import { terminalFfmpeg, terminalTimelineHost } from './timeline-host';
import { loadSharp } from './runtime';
import type { Session } from './session';

export { TIMELINE_OPTIONS, validateTimelineOptions } from './timeline-plan';

async function existing(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Shared runner + Node adapters for CLI commands and TUI exports. */
export async function exportTimeline(
  session: Session,
  values: Record<string, unknown>,
  options: TimelineRunOptions = {},
) {
  const check = () => {
    if (options.signal?.aborted) throw new RenderCancelledError();
  };
  check();
  const input = session.path ?? resolve(`${safeName(session.name)}.gleech`);
  const plan = cliTimelinePlan(session.state, input, values);
  if (!loadSharp()) throw new Error('Timeline exports need Sharp. Run pnpm install.');
  const { request, outputPath, format, overwrite } = plan;
  const pathKey = (path: string) =>
    process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  const sequence = format === 'png';
  const prefix = safeName(request.spec.name) + '_';
  // Sequence replacement owns a dedicated frame folder. Refuse unrelated files
  // even with -y so choosing a project/media directory cannot erase its contents.
  const validateTarget = async () => {
    const info = await existing(outputPath);
    if (!info) return;
    if (!overwrite) throw new Error(`${outputPath} exists. Use --overwrite (-y) to replace it.`);
    if (info.isSymbolicLink() || (sequence ? !info.isDirectory() : !info.isFile()))
      throw new Error('Choose a regular output file, or a dedicated folder for PNG frames.');
    if (sequence) {
      const entries = await readdir(outputPath, { withFileTypes: true });
      if (
        entries.some(
          (entry) =>
            !entry.isFile() ||
            !entry.name.startsWith(prefix) ||
            !/^\d{4,}\.png$/.test(entry.name.slice(prefix.length)),
        )
      )
        throw new Error(
          'The output folder contains files outside this sequence. Choose a dedicated frame folder.',
        );
    }
  };
  for (const path of [
    session.path,
    request.project.timeline?.video?.path,
    request.project.timeline?.audio?.path,
  ])
    if (path && pathKey(path) === pathKey(outputPath))
      throw new Error('The output must differ from the project and its media files.');
  await validateTarget();
  check();
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = await mkdtemp(join(dirname(outputPath), '.gleech-timeline-'));
  const staged = join(temporary, sequence ? 'frames' : `render.${format}`);
  const backup = join(temporary, 'previous-frames');
  let keepBackup = false;
  const jobs = createRenderJobs({ ffmpeg: terminalFfmpeg(session) });
  const host = terminalTimelineHost(
    session,
    request.project,
    options.signal ? { signal: options.signal } : {},
  );
  const started = performance.now();
  try {
    const result = await runTimelineRender(
      { ...request, spec: { ...request.spec, outputPath: staged } },
      {
        ...host.adapters,
        begin: async (spec) => {
          const id = await jobs.begin(spec);
          return {
            frame: (image, original) => jobs.frame(id, image, original),
            finish: () => jobs.finish(id),
            cancel: () => jobs.cancel(id),
          };
        },
      },
      options,
    );
    check();
    await validateTarget();
    check();
    if (sequence) {
      const previous = !!(await existing(outputPath));
      if (previous) await rename(outputPath, backup);
      try {
        await rename(staged, outputPath);
      } catch (error) {
        if (previous) {
          try {
            await rename(backup, outputPath);
          } catch {
            keepBackup = true;
            throw new Error(
              `Could not publish frames or restore the previous export. It is preserved at ${backup}.`,
            );
          }
        }
        throw error;
      }
    } else if (overwrite) await rename(staged, outputPath);
    else {
      // link is an atomic no-replace publish on the same filesystem.
      await link(staged, outputPath);
      await unlink(staged);
    }
    return {
      input: session.path,
      output: outputPath,
      format,
      ...plan.size,
      fps: request.inputFps,
      frames: request.times.length,
      range: plan.range,
      bytes: result.bytes,
      files: result.files,
      backends: [...host.backends],
      warnings: [...host.warnings],
      notes: result.notes,
      milliseconds: Math.round(performance.now() - started),
    };
  } finally {
    host.dispose();
    await jobs.dispose();
    // Only remove the exact mkdtemp child allocated above, never the output.
    if (
      !keepBackup &&
      dirname(resolve(temporary)) === resolve(dirname(outputPath)) &&
      basename(temporary).startsWith('.gleech-timeline-')
    )
      await rm(temporary, { recursive: true, force: true });
  }
}
