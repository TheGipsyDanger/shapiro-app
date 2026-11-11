import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { generateId } from '@/utils/id';
import type { VaultPhoto } from '@/types/domain';

export const MIN_FREE_DISK_BYTES = 500 * 1024 * 1024; // 500 MB safeguard

export class InsufficientStorageError extends Error {
  constructor(availableBytes: number) {
    super(
      `Insufficient device storage (${Math.round(availableBytes / (1024 * 1024))} MB free). At least 500 MB is required.`
    );
    this.name = 'InsufficientStorageError';
  }
}

export function hasSufficientDiskSpace(): { ok: boolean; availableBytes: number } {
  try {
    const availableBytes = Paths.availableDiskSpace;
    // Some simulator environments may return 0 or negative when unavailable; only block if a real positive limit is under threshold
    if (availableBytes > 0 && availableBytes < MIN_FREE_DISK_BYTES) {
      return { ok: false, availableBytes };
    }
    return { ok: true, availableBytes };
  } catch {
    return { ok: true, availableBytes: MIN_FREE_DISK_BYTES };
  }
}

export function ensureVaultSubjectDir(subjectId: string): Directory {
  const dir = new Directory(Paths.document, 'vault', subjectId);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export async function saveCapturedPhotoToVault(
  tempUri: string,
  subjectId: string,
  blockId: string
): Promise<{ filePath: string; fileSizeBytes: number }> {
  const storage = hasSufficientDiskSpace();
  if (!storage.ok) {
    throw new InsufficientStorageError(storage.availableBytes);
  }

  const subjectDir = ensureVaultSubjectDir(subjectId);
  const fileName = `${blockId}_${generateId('shot')}.jpg`;
  const targetFile = new File(subjectDir, fileName);
  const sourceFile = new File(tempUri);

  await sourceFile.move(targetFile);

  const info = targetFile.info();
  const fileSizeBytes = info.size ?? 0;

  return {
    filePath: targetFile.uri,
    fileSizeBytes,
  };
}

export function deleteVaultFile(filePath: string): void {
  try {
    const file = new File(filePath);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Ignore missing file errors during cleanup
  }
}

export async function exportBlockPhotosToCameraRoll(
  photos: VaultPhoto[],
  subjectName: string,
  onProgress?: (current: number, total: number) => void
): Promise<{ exportedCount: number; albumTitle: string }> {
  if (photos.length === 0) {
    return { exportedCount: 0, albumTitle: `Shapiro - ${subjectName}` };
  }

  const permission = await MediaLibrary.requestPermissionsAsync(false);
  if (!permission.granted) {
    throw new Error('Photo library permission is required to export Study Vault photos.');
  }

  const albumTitle = `Shapiro - ${subjectName}`;
  const createdAssets: MediaLibrary.Asset[] = [];

  for (let i = 0; i < photos.length; i += 1) {
    const photo = photos[i];
    onProgress?.(i + 1, photos.length);
    const asset = await MediaLibrary.Asset.create(photo.filePath);
    createdAssets.push(asset);
  }

  const existingAlbum = await MediaLibrary.Album.get(albumTitle);
  if (existingAlbum) {
    await existingAlbum.add(createdAssets);
  } else {
    await MediaLibrary.Album.create(albumTitle, createdAssets, false);
  }

  return {
    exportedCount: createdAssets.length,
    albumTitle,
  };
}

// --- Pure-TS uncompressed PNG generator for iOS Simulator fallback (no hardware camera) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeU32BE(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = (val >>> 24) & 0xff;
  arr[offset + 1] = (val >>> 16) & 0xff;
  arr[offset + 2] = (val >>> 8) & 0xff;
  arr[offset + 3] = val & 0xff;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32BE(out, 0, data.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  writeU32BE(out, 8 + data.length, crc32(crcInput));
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [16, 185, 129];
  const r = parseInt(clean.slice(0, 2), 16) || 16;
  const g = parseInt(clean.slice(2, 4), 16) || 185;
  const b = parseInt(clean.slice(4, 6), 16) || 129;
  return [r, g, b];
}

function buildStudyNotePng(accentHex: string, variantSeed: number): Uint8Array {
  const width = 360;
  const height = 480;
  const [ar, ag, ab] = hexToRgb(accentHex);

  // Raw scanlines: 1 filter byte + width * 3 RGB bytes per row
  const rowStride = 1 + width * 3;
  const raw = new Uint8Array(rowStride * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowStride;
    raw[rowOffset] = 0; // filter: None

    const isMajorGridY = y % 48 === 0;
    const isRuledLine = y > 96 && y < 430 && y % 28 === 0;

    for (let x = 0; x < width; x += 1) {
      const px = rowOffset + 1 + x * 3;
      let r = 14;
      let g = 16;
      let b = 22;

      const isMajorGridX = x % 48 === 0;
      if (isMajorGridX || isMajorGridY) {
        r = 28;
        g = 32;
        b = 42;
      }

      // Header bar accent
      if (y >= 28 && y <= 34 && x >= 28 && x <= 140) {
        r = ar;
        g = ag;
        b = ab;
      }

      // Margin vertical rule
      if (x === 44 && y >= 60 && y <= 440) {
        r = ar;
        g = ag;
        b = ab;
      }

      // Ruled notebook lines
      if (isRuledLine && x >= 28 && x <= 332) {
        r = 38;
        g = 42;
        b = 54;
      }

      // Simulated handwritten note strokes & geometric diagram
      if (x > 64 && x < 290 && y > 110 && y < 380) {
        const lineIdx = Math.floor((y - 110) / 28);
        const yInLine = (y - 110) % 28;
        const wave = Math.sin((x + variantSeed * 37 + lineIdx * 19) * 0.14) * 3;
        const maxLineLen = 140 + ((lineIdx * 53 + variantSeed * 29) % 90);
        const gap = ((x + lineIdx * 23) % 41) < 6;
        if (
          lineIdx % 2 === 0 &&
          x - 64 < maxLineLen &&
          !gap &&
          Math.abs(yInLine - 14 - wave) < 1.6
        ) {
          r = 235;
          g = 238;
          b = 245;
        }
      }

      // Highlighted formula box in bottom-right
      if (x >= 180 && x <= 324 && y >= 320 && y <= 410) {
        const border = x <= 182 || x >= 322 || y <= 322 || y >= 408;
        if (border) {
          r = ar;
          g = ag;
          b = ab;
        } else if ((x - 252) * (x - 252) + (y - 365) * (y - 365) < 520 && (x - 252) * (x - 252) + (y - 365) * (y - 365) > 380) {
          r = 240;
          g = 244;
          b = 250;
        }
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }

  // Wrap raw scanlines in zlib stored blocks (max 65535 per block)
  const maxBlock = 65535;
  const numBlocks = Math.ceil(raw.length / maxBlock);
  const zlibLen = 2 + raw.length + numBlocks * 5 + 4;
  const zlib = new Uint8Array(zlibLen);
  zlib[0] = 0x78; // CMF
  zlib[1] = 0x01; // FLG

  let zPos = 2;
  let rPos = 0;
  for (let i = 0; i < numBlocks; i += 1) {
    const remaining = raw.length - rPos;
    const len = Math.min(maxBlock, remaining);
    const isFinal = i === numBlocks - 1 ? 1 : 0;
    zlib[zPos] = isFinal;
    zlib[zPos + 1] = len & 0xff;
    zlib[zPos + 2] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    zlib[zPos + 3] = nlen & 0xff;
    zlib[zPos + 4] = (nlen >>> 8) & 0xff;
    zPos += 5;
    zlib.set(raw.subarray(rPos, rPos + len), zPos);
    zPos += len;
    rPos += len;
  }
  writeU32BE(zlib, zPos, adler32(raw));

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  writeU32BE(ihdrData, 0, width);
  writeU32BE(ihdrData, 4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdr = makePngChunk('IHDR', ihdrData);
  const idat = makePngChunk('IDAT', zlib);
  const iend = makePngChunk('IEND', new Uint8Array(0));

  const total = new Uint8Array(sig.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  total.set(sig, offset);
  offset += sig.length;
  total.set(ihdr, offset);
  offset += ihdr.length;
  total.set(idat, offset);
  offset += idat.length;
  total.set(iend, offset);
  return total;
}

export async function createSimulatorSampleVaultPhoto(
  subjectId: string,
  blockId: string,
  accentHex: string,
  variantSeed: number
): Promise<{ filePath: string; fileSizeBytes: number }> {
  const storage = hasSufficientDiskSpace();
  if (!storage.ok) {
    throw new InsufficientStorageError(storage.availableBytes);
  }

  const subjectDir = ensureVaultSubjectDir(subjectId);
  const fileName = `${blockId}_${generateId('sim')}.png`;
  const targetFile = new File(subjectDir, fileName);
  const pngBytes = buildStudyNotePng(accentHex, variantSeed);
  targetFile.create({ overwrite: true });
  await targetFile.write(pngBytes);

  return {
    filePath: targetFile.uri,
    fileSizeBytes: pngBytes.byteLength,
  };
}

