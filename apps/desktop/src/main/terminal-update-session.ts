import type { UpdateEngine } from './update-controller';
import type { UpdateRelease } from '../shared/updates';
import type { TerminalUpdateEvent } from '../shared/terminal-updates';

/** No install is permitted until verification, explicit approval and terminal exit. */
export function createTerminalUpdateSession(options: {
  mode: 'native' | 'finder';
  discover(): Promise<UpdateRelease | null>;
  engine: UpdateEngine;
  saveNotes(release: UpdateRelease): Promise<void>;
  send(event: TerminalUpdateEvent): void;
}) {
  let phase: 'idle' | 'preparing' | 'ready' | 'armed' | 'closed' = 'idle';
  return {
    async prepare(version: string) {
      if (phase !== 'idle' || !/^\d+\.\d+\.\d+$/.test(version))
        throw new Error('Invalid terminal update request.');
      phase = 'preparing';
      const release = await options.discover();
      if (!release || release.version !== version)
        throw new Error('The available release changed. Check for updates again.');
      if (phase !== 'preparing') return;
      await options.engine.check(release);
      if (phase !== 'preparing') return;
      await options.engine.download(release, (progress) => {
        if (phase === 'preparing') options.send({ type: 'progress', progress });
      });
      if (phase !== 'preparing') return;
      await options.saveNotes(release);
      if (phase !== 'preparing') return;
      phase = 'ready';
      options.send({ type: 'ready', version: release.version, mode: options.mode });
    },
    arm() {
      if (phase !== 'ready') throw new Error('Download and verify the update before installing.');
      phase = 'armed';
      options.send({ type: 'armed' });
    },
    cancel() {
      phase = 'closed';
      options.engine.cancel();
    },
    async disconnected() {
      const install = phase === 'armed';
      phase = 'closed';
      if (install) await options.engine.install();
      else options.engine.cancel();
      return install;
    },
  };
}
