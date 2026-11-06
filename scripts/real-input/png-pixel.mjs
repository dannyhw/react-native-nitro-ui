/**
 * The one pixel of a PNG an Android real-input check wants.
 *
 * A check that has to prove *what is painted* - a connected corner, a clipped
 * ripple - has to read the screen, and the only screen read this suite makes is
 * `adb exec-out screencap -p`, which hands back a PNG. Decoding it here rather
 * than adding a dependency:
 *
 * - `pngjs` and `pixelmatch` are in `node_modules` as somebody else's transitive
 *   dependency. A gate that imports one of them works until an unrelated package
 *   updates, and then it fails for a reason that has nothing to do with the
 *   control under test.
 * - `magick`/`sips` can print a pixel (CONTRIBUTING's "README screenshots" reads a
 *   card's edges with them), but they are a developer's tools and this repo's own
 *   rule is that nothing a gate needs is a tool it does not declare.
 *
 * So this reads what `screencap` actually produces and refuses anything else: an
 * 8-bit, non-interlaced RGB or RGBA image, which is what Android writes. The
 * header is checked rather than trusted, because a decoder that guesses gets a
 * wrong *number* out of a wrong assumption, and a check that reads the wrong
 * number passes. A file this cannot describe is an error, never a default.
 *
 * Only the scanlines are decoded, and the whole image at once: a 1080x2424 screen
 * is 10 MiB of pixels, which is nothing, and decoding lazily per pixel would mean
 * unfiltering the previous line anyway (every filter but `None` reads it).
 */

import zlib from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A decoded image: its size and its pixels, top-left first, `channels` per pixel.
 *
 * @typedef {object} DecodedPng
 * @property {number} width
 * @property {number} height
 * @property {number} channels 3 for an RGB image, 4 for RGBA
 * @property {Uint8Array} pixels `width * height * channels` bytes, row-major
 */

/**
 * @param {Buffer|Uint8Array} buffer a PNG, as `screencap -p` wrote it
 * @returns {DecodedPng}
 */
export function decodePng(buffer) {
  const bytes =
    buffer instanceof Uint8Array
      ? buffer
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) {
      throw new Error('png-pixel: not a PNG (the signature is not there)');
    }
  }

  /** @type {Uint8Array[]} */
  const idat = [];
  let width = 0;
  let height = 0;
  let channels = 0;
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = readUInt32(bytes, offset);
    const type = readType(bytes, offset + 4);
    const dataStart = offset + 8;
    if (dataStart + length > bytes.length) {
      throw new Error(
        `png-pixel: the ${type} chunk claims ${String(length)} bytes past the end of the file`
      );
    }
    if (type === 'IHDR') {
      width = readUInt32(bytes, dataStart);
      height = readUInt32(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8] ?? 0;
      const colorType = bytes[dataStart + 9] ?? 0;
      const compression = bytes[dataStart + 10] ?? 0;
      const filter = bytes[dataStart + 11] ?? 0;
      const interlace = bytes[dataStart + 12] ?? 0;
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(
          `png-pixel: this PNG is ${String(bitDepth)}-bit colour type ${String(colorType)}; ` +
            'this decoder reads 8-bit RGB (2) and RGBA (6) only, which is what `screencap -p` writes'
        );
      }
      if (compression !== 0 || filter !== 0) {
        throw new Error(
          `png-pixel: compression ${String(compression)} / filter ${String(filter)} are not the deflate + adaptive-filter encoding PNG defines`
        );
      }
      if (interlace !== 0) {
        throw new Error(
          'png-pixel: this PNG is interlaced (Adam7), whose scanlines are not rows; nothing here can say which row a pixel is on'
        );
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4; // past the data and its CRC
  }

  if (width < 1 || height < 1 || channels === 0) {
    throw new Error('png-pixel: no IHDR to describe the image');
  }
  if (idat.length === 0) {
    throw new Error('png-pixel: no IDAT to decode');
  }

  const raw = zlib.inflateSync(concat(idat));
  const stride = width * channels;
  if (raw.length < stride * height + height) {
    throw new Error(
      `png-pixel: ${String(raw.length)} decoded bytes cannot hold ${String(height)} lines of ` +
        `${String(stride)} pixels plus a filter byte each`
    );
  }

  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)] ?? 0;
    unfilterRow(
      filter,
      raw,
      row * (stride + 1) + 1,
      pixels,
      row * stride,
      stride,
      channels
    );
  }

  return {
    width,
    height,
    channels,
    pixels,
  };
}

/**
 * The RGBA of one pixel, as four numbers 0-255.
 *
 * Out of range is an error and not a black pixel: a check whose coordinates ran
 * past the edge would otherwise read the page as black and call it a border.
 *
 * @param {DecodedPng} image
 * @param {number} x
 * @param {number} y
 * @returns {[number, number, number, number]}
 */
export function pixelAt(image, x, y) {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= image.width ||
    y >= image.height
  ) {
    throw new Error(
      `png-pixel: (${String(x)}, ${String(y)}) is outside a ${String(image.width)}x${String(image.height)} image`
    );
  }
  const at = (y * image.width + x) * image.channels;
  return [
    image.pixels[at] ?? 0,
    image.pixels[at + 1] ?? 0,
    image.pixels[at + 2] ?? 0,
    image.channels === 4 ? (image.pixels[at + 3] ?? 0) : 255,
  ];
}

/**
 * Undo one PNG scanline filter in place.
 *
 * `None`, `Sub`, `Up`, `Average` and `Paeth` are the five PNG defines; each
 * reconstructs a byte from bytes this function has already reconstructed (`Sub`
 * from the one `bpp` back in this line, `Up` from the line above, the rest from
 * both), which is why a line cannot be decoded out of order.
 *
 * @param {number} filter
 * @param {Uint8Array} raw
 * @param {number} from offset of this line's first pixel byte in `raw`
 * @param {Uint8Array} out
 * @param {number} to offset of this line's first pixel byte in `out`
 * @param {number} stride bytes in one line
 * @param {number} channels bytes in one pixel - also PNG's `bpp`, at 8 bits deep
 */
function unfilterRow(filter, raw, from, out, to, stride, channels) {
  if (filter === 0) {
    out.set(raw.subarray(from, from + stride), to);
    return;
  }
  if (filter < 0 || filter > 4) {
    throw new Error(
      `png-pixel: filter type ${String(filter)} is not one of PNG's five`
    );
  }
  const bpp = channels;
  for (let index = 0; index < stride; index += 1) {
    const a = index >= bpp ? (out[(to + index - bpp) | 0] ?? 0) : 0;
    const b = to >= stride ? (out[(to + index - stride) | 0] ?? 0) : 0;
    const c =
      index >= bpp && to >= stride
        ? (out[(to + index - stride - bpp) | 0] ?? 0)
        : 0;
    const value = raw[from + index] ?? 0;
    let reconstructed;
    if (filter === 1) {
      reconstructed = value + a;
    } else if (filter === 2) {
      reconstructed = value + b;
    } else if (filter === 3) {
      reconstructed = value + Math.floor((a + b) / 2);
    } else {
      reconstructed = value + paeth(a, b, c);
    }
    out[to + index] = reconstructed & 0xff;
  }
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {number}
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Buffer}
 */
function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = Buffer.allocUnsafe(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @returns {number}
 */
function readUInt32(bytes, at) {
  return (
    ((bytes[at] ?? 0) * 0x1000000 +
      (bytes[at + 1] ?? 0) * 0x10000 +
      (bytes[at + 2] ?? 0) * 0x100 +
      (bytes[at + 3] ?? 0)) |
    0
  );
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @returns {string}
 */
function readType(bytes, at) {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0
  );
}
