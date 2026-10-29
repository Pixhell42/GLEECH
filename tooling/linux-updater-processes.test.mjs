import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findImageDesktop,
  ownedImageDescendants,
  parseLinuxProcessStat,
} from './linux-updater-processes.mjs';

const image = '/workspace/installed/GLEECH-0.2.1-linux-x86_64.AppImage';
const launcher = { pid: 100, parent: 1, start: '123', executable: image };
const desktop = {
  pid: 101,
  parent: 100,
  start: '124',
  executable: '/tmp/appimage_extracted_abcdef/gleech-bin',
};
const renderer = { pid: 102, parent: 101, start: '125', executable: desktop.executable };

test('finds the owned desktop without depending on proc environment contents', () => {
  assert.deepEqual(findImageDesktop([launcher, desktop, renderer], image), {
    ...desktop,
    launcher,
  });
  const protectedDesktop = { ...desktop, executable: null, name: 'GLEECH' };
  assert.deepEqual(findImageDesktop([launcher, protectedDesktop], image), {
    ...protectedDesktop,
    launcher,
  });
});
test('rejects other images and an obsolete deleted launcher for relaunch acceptance', () => {
  assert.equal(
    findImageDesktop([{ ...launcher, executable: image + ' (deleted)' }, desktop], image),
    null,
  );
  assert.equal(
    findImageDesktop([{ ...launcher, executable: '/elsewhere/other.AppImage' }, desktop], image),
    null,
  );
  assert.equal(findImageDesktop([desktop, renderer], image), null);
  assert.equal(
    findImageDesktop([launcher, { ...desktop, executable: null, name: 'AppRun' }], image),
    null,
  );
});
test('cleanup selects only descendants of the exact owned image, including deleted instances', () => {
  const unrelated = { pid: 200, parent: 1, start: '200', executable: desktop.executable };
  assert.deepEqual(ownedImageDescendants([launcher, desktop, renderer, unrelated], image), [
    launcher,
    desktop,
    renderer,
  ]);
  assert.deepEqual(
    ownedImageDescendants(
      [{ ...launcher, executable: image + ' (deleted)' }, desktop, unrelated],
      image,
    ).map((record) => record.pid),
    [100, 101],
  );
});
test('parses stable process identity when the command name contains spaces and parentheses', () => {
  const fields = ['S', '100', ...Array(17).fill('0'), '98765', '0'];
  assert.deepEqual(
    parseLinuxProcessStat(101, '101 (GLEECH (main)) ' + fields.join(' '), desktop.executable),
    { ...desktop, start: '98765', name: 'GLEECH (main)' },
  );
});
