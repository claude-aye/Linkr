import sharp = require('sharp');
import {
  PORTFOLIO_MAX_BYTES,
  PORTFOLIO_OUTPUT_MAX_SIDE,
} from './constants';
import {
  PortfolioFileTooLargeException,
  PortfolioImageTooManyPixelsException,
  PortfolioUnsupportedImageException,
} from './exceptions/portfolio-exceptions';
import { PortfolioImageProcessor } from './portfolio-image.processor';

/**
 * Every fixture is GENERATED HERE with sharp — no binary in the repository.
 *
 * ⚠️ The portrait fixture is tagged with `withMetadata({ orientation: 6 })`,
 * NOT `withExif({ IFD0: { Orientation: '6' } })`: measured during the recon,
 * the latter writes a tag libvips does not read back (orientation stays 1), so
 * a test built on it would pass with or without `.rotate()` and prove nothing.
 */
describe('PortfolioImageProcessor', () => {
  const processor = new PortfolioImageProcessor();

  const solid = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });

  it('strips EXIF (GPS included), XMP and IPTC from the output', async () => {
    const input = await solid(640, 480)
      .jpeg()
      .withExif({
        IFD0: { Make: 'LinkrTestPhone', Model: 'Probe' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '45/1 30/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '73/1 34/1 0/1',
        },
      })
      .toBuffer();

    // The fixture really carries a GPS block — otherwise this test proves nothing.
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.exif!.includes(Buffer.from('LinkrTestPhone'))).toBe(true);

    const out = await processor.process(input);
    const after = await sharp(out.buffer).metadata();

    expect(after.format).toBe('webp');
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(out.buffer.includes(Buffer.from('LinkrTestPhone'))).toBe(false);
    expect(out.contentType).toBe('image/webp');
  });

  it('applies the EXIF orientation: an 800×600 JPEG tagged 6 comes out 600×800', async () => {
    const input = await solid(800, 600).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const out = await processor.process(input);

    expect(out.width).toBe(600);
    expect(out.height).toBe(800);
    const after = await sharp(out.buffer).metadata();
    expect(after.width).toBe(600);
    expect(after.height).toBe(800);
    // Applied to the pixels, so no tag is left to be (mis)applied twice.
    expect(after.orientation).toBeUndefined();
  });

  it('caps the longest side at 1600 px, preserving the ratio', async () => {
    const out = await processor.process(await solid(4000, 3000).png().toBuffer());
    expect(Math.max(out.width, out.height)).toBe(PORTFOLIO_OUTPUT_MAX_SIDE);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);
  });

  it('never enlarges a small image', async () => {
    const out = await processor.process(await solid(500, 400).webp().toBuffer());
    expect(out.width).toBe(500);
    expect(out.height).toBe(400);
  });

  it('reports the size, width and height of the OUTPUT, not of the upload', async () => {
    const input = await solid(2400, 1800).jpeg({ quality: 100 }).toBuffer();
    const out = await processor.process(input);
    expect(out.byteSize).toBe(out.buffer.length);
    expect(out.byteSize).not.toBe(input.length);
    expect([out.width, out.height]).toEqual([1600, 1200]);
  });

  it('refuses a text file renamed .jpg with 415 (the bytes decide, not the name)', async () => {
    const input = Buffer.from('this is not an image, whatever the extension says');
    await expect(processor.process(input)).rejects.toBeInstanceOf(
      PortfolioUnsupportedImageException,
    );
  });

  it('refuses a GIF with 415', async () => {
    const input = await solid(50, 50).gif().toBuffer();
    expect((await sharp(input).metadata()).format).toBe('gif');
    await expect(processor.process(input)).rejects.toBeInstanceOf(
      PortfolioUnsupportedImageException,
    );
  });

  it('refuses an animated WebP with 415', async () => {
    // Two DIFFERENT frames: libwebp merges identical ones into a single still
    // image (measured), which would make this test pass for the wrong reason.
    const red = await solid(40, 40).png().toBuffer();
    const blue = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .png()
      .toBuffer();
    const input = await sharp([red, blue], { join: { animated: true } })
      .webp({ loop: 0 })
      .toBuffer();
    expect((await sharp(input).metadata()).pages).toBe(2);
    await expect(processor.process(input)).rejects.toBeInstanceOf(
      PortfolioUnsupportedImageException,
    );
  });

  it('refuses a truncated JPEG whose header parses with 415', async () => {
    const full = await solid(800, 600).jpeg().toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    await expect(processor.process(truncated)).rejects.toBeInstanceOf(
      PortfolioUnsupportedImageException,
    );
  });

  it('refuses a file over 5 MB with 413, before reading it as an image', async () => {
    const input = Buffer.alloc(PORTFOLIO_MAX_BYTES + 1);
    await expect(processor.process(input)).rejects.toBeInstanceOf(
      PortfolioFileTooLargeException,
    );
  });

  it('accepts a file of exactly 5 MB as far as size goes (the limit is inclusive)', async () => {
    // Exactly at the limit, but not an image: it must fail on FORMAT (415),
    // which proves it went past the size check.
    const input = Buffer.alloc(PORTFOLIO_MAX_BYTES);
    await expect(processor.process(input)).rejects.toBeInstanceOf(
      PortfolioUnsupportedImageException,
    );
  });

  it('refuses an image over the pixel limit with 422 (decompression-bomb guard)', async () => {
    // 7000 × 6000 = 42 MP, single channel so the fixture stays cheap to build.
    const input = await sharp({
      create: { width: 7000, height: 6000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .greyscale()
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(input.length).toBeLessThan(PORTFOLIO_MAX_BYTES);
    await expect(processor.process(input)).rejects.toBeInstanceOf(
      PortfolioImageTooManyPixelsException,
    );
  }, 30_000);
});
