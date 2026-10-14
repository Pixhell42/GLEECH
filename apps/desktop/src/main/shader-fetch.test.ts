import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ get: mocks.get }));
import { fetchShader, publicShaderAddress, shaderUrl } from './shader-fetch';

function response(body: string, status = 200, headers: Record<string, string> = {}) {
  mocks.get.mockImplementationOnce((options, callback) => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: status,
      headers,
      resume: vi.fn(),
      destroy: vi.fn(),
    });
    queueMicrotask(() => {
      callback(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    return new EventEmitter();
  });
}
describe('direct public HTTPS shader fetching', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });
  it.each([
    'http://example.com/x',
    'https://user:secret@example.com/x',
    'https://example.com:8080/x',
    'not a url',
  ])('rejects invalid URLs %s', (value) => expect(() => shaderUrl(value)).toThrow());
  it('converts GitHub blob links and removes fragments', () =>
    expect(shaderUrl('https://github.com/a/b/blob/main/file.fs#L1').href).toBe(
      'https://raw.githubusercontent.com/a/b/main/file.fs',
    ));
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.18.0.1',
    '203.0.113.1',
    '0.0.0.0',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2001:0001::1',
    '2002:7f00:1::1',
    '3fff::1',
  ])('rejects nonpublic address %s', (address) => expect(publicShaderAddress(address)).toBe(false));
  it.each(['93.184.216.34', '1.1.1.1', '2606:4700::1111', '2001:4860:4860::8888'])(
    'accepts public address %s',
    (address) => expect(publicShaderAddress(address)).toBe(true),
  );
  it('pins public DNS and preserves source URL and declared metadata', async () => {
    response(
      '/*{"ISFVSN":"2","CREDIT":"Creator","LICENSE":"MIT","INPUTS":[]}*/void main(){gl_FragColor=vec4(1.0);}',
    );
    const pkg = await fetchShader('https://example.com/light.fs');
    expect(pkg.sourceUrl).toBe('https://example.com/light.fs');
    expect(pkg.authors[0]?.name).toBe('Creator');
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      hostname: '93.184.216.34',
      servername: 'example.com',
      path: '/light.fs',
    });
  });
  it('checks each redirected host and rejects DNS that includes a private address', async () => {
    response('', 302, { location: 'https://internal.example.com/x' });
    mocks.lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(fetchShader('https://example.com/x')).rejects.toThrow('public');
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it.each([
    [404, {}],
    [200, { 'content-type': 'text/html' }],
    [200, { 'content-length': '999999' }],
  ])('rejects HTTP/page/size failures %j', async (status, headers) => {
    response('invalid', status as number, headers as Record<string, string>);
    await expect(fetchShader('https://example.com/x')).rejects.toThrow();
  });
  it('bounds streamed bodies even without Content-Length', async () => {
    response('x'.repeat(256 * 1024 + 1));
    await expect(fetchShader('https://example.com/x')).rejects.toThrow('256 KiB');
  });
});
