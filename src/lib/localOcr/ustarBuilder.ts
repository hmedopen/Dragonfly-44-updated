/**
 * Pure TypeScript POSIX USTAR tar archive builder (uncompressed).
 * Required by @paddleocr/paddleocr-js 0.4.2 custom model asset loading,
 * which reads inference.onnx and inference.yml from an uncompressed USTAR .tar stream.
 */

export interface UstarEntryInput {
  name: string;
  data: Uint8Array;
}

const textEncoder = new TextEncoder();

function writeAscii(target: Uint8Array, offset: number, length: number, value: string) {
  const bytes = textEncoder.encode(value);
  const copyLen = Math.min(bytes.length, length);
  for (let i = 0; i < copyLen; i++) {
    target[offset + i] = bytes[i];
  }
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number) {
  const octal = Math.max(0, Math.floor(value)).toString(8);
  const padded = octal.padStart(length - 1, '0');
  writeAscii(target, offset, length - 1, padded.slice(-(length - 1)));
  target[offset + length - 1] = 0;
}

export function buildUstarArchive(entries: UstarEntryInput[]): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const entry of entries) {
    const cleanName = entry.name.replace(/^\/+/, '');
    if (cleanName.length === 0 || cleanName.length > 99) {
      throw new Error(`Invalid USTAR entry name "${entry.name}" (must be 1..99 ASCII chars).`);
    }

    const header = new Uint8Array(512);
    // name [0..99]
    writeAscii(header, 0, 100, cleanName);
    // mode [100..107]
    writeOctal(header, 100, 8, 0o644);
    // uid [108..115]
    writeOctal(header, 108, 8, 0);
    // gid [116..123]
    writeOctal(header, 116, 8, 0);
    // size [124..135]
    writeOctal(header, 124, 12, entry.data.byteLength);
    // mtime [136..147]
    writeOctal(header, 136, 12, 0);
    // chksum [148..155] — filled with spaces before checksum calculation
    for (let i = 148; i < 156; i++) {
      header[i] = 0x20;
    }
    // typeflag [156] ('0' = regular file)
    header[156] = 0x30;
    // magic [257..262] = "ustar\0"
    writeAscii(header, 257, 6, 'ustar\0');
    // version [263..264] = "00"
    header[263] = 0x30;
    header[264] = 0x30;

    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    const chkStr = checksum.toString(8).padStart(6, '0');
    writeAscii(header, 148, 6, chkStr);
    header[154] = 0;
    header[155] = 0x20;

    blocks.push(header);

    const paddedSize = Math.ceil(entry.data.byteLength / 512) * 512;
    if (paddedSize > 0) {
      const dataBlock = new Uint8Array(paddedSize);
      dataBlock.set(entry.data, 0);
      blocks.push(dataBlock);
    }
  }

  // Two 512-byte zero blocks at EOF
  blocks.push(new Uint8Array(1024));

  const totalLength = blocks.reduce((sum, b) => sum + b.byteLength, 0);
  const archive = new Uint8Array(totalLength);
  let cursor = 0;
  for (const block of blocks) {
    archive.set(block, cursor);
    cursor += block.byteLength;
  }
  return archive;
}
