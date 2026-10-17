import { promises as fs } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';

describe('LocalDiskStorageAdapter.delete', () => {
  let dir: string;
  let adapter: LocalDiskStorageAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'linkr-storage-spec-'));
    adapter = new LocalDiskStorageAdapter({
      get: (key: string, fallback?: string) => (key === 'STORAGE_LOCAL_DIR' ? dir : fallback),
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('deletes the file', async () => {
    await adapter.upload({ buffer: Buffer.from('x'), key: 'a/b.webp', mimeType: 'image/webp' });
    await adapter.delete('a/b.webp');
    await expect(fs.access(join(dir, 'a/b.webp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is a no-op on a missing file (idempotent)', async () => {
    await expect(adapter.delete('never/there.webp')).resolves.toBeUndefined();
  });

  it('REPORTS any other failure instead of pretending it worked', async () => {
    const eperm = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    jest.spyOn(fs, 'unlink').mockRejectedValueOnce(eperm);
    await expect(adapter.delete('a/b.webp')).rejects.toBe(eperm);
  });
});
