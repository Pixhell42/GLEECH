import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { startUpdateFixture } from './updater-acceptance-fixtures.mjs';

test('first-hop transport advertises the exact candidate after future-update tests', async () => {
  const reserve = createServer();
  await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
  const port = reserve.address().port;
  await new Promise((done) => reserve.close(done));
  const config = {
    senderVersion: '0.2.1',
    version: '0.2.2',
    serverPort: port,
    manifest: 'latest-x64.yml',
    payload: {
      archive: 'GLEECH-0.2.2-x64-setup.exe',
      bytes: 123,
      sha256: 'a'.repeat(64),
      sha512: 'fixture-sha512',
    },
  };
  const fixture = await startUpdateFixture(config);
  try {
    const releases = () => fetch(fixture.origin + '/releases').then((response) => response.json());
    assert.equal((await releases())[0].tag_name, 'v0.2.2');
    config.version = '0.2.1';
    config.payload = {
      archive: 'GLEECH-0.2.1-x64-setup.exe',
      bytes: 456,
      sha256: 'b'.repeat(64),
      sha512: 'candidate-sha512',
    };
    const [release] = await releases();
    assert.equal(release.tag_name, 'v0.2.1');
    assert.equal(release.assets[1].digest, 'sha256:' + 'b'.repeat(64));
    assert.equal(
      release.assets[1].browser_download_url,
      'https://github.com/Pixhell42/GLEECH/releases/download/v0.2.1/GLEECH-0.2.1-x64-setup.exe',
    );
    const response = await fetch(
      fixture.origin + '/Pixhell42/GLEECH/releases/download/v0.2.1/latest-x64.yml',
    );
    assert.equal(response.status, 200);
    const manifest = await response.text();
    assert.match(manifest, /^version: 0\.2\.1\n/);
    assert.match(manifest, /sha512: candidate-sha512/);
    assert.match(manifest, /size: 456/);
    assert.equal(
      (await fetch(fixture.origin + '/Pixhell42/GLEECH/releases/download/v0.2.2/latest-x64.yml'))
        .status,
      404,
    );
  } finally {
    await fixture.close();
  }
});
