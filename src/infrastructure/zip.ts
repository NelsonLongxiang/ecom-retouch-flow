import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import * as yazl from 'yazl';
import { requireThat, RetouchError } from '../domain/model.ts';

export const ZIP_LIMITS = { archive: 256 * 1024 * 1024, expanded: 512 * 1024 * 1024, entry: 32 * 1024 * 1024, entries: 10000, ratio: 1000 };
export function zipPath(name: string) {
  requireThat(name.length > 0 && name.length < 512 && !name.startsWith('/') && !/[\\:\x00-\x1f\uFFFD]/.test(name) && name.normalize('NFC') === name, 'ZIP_PATH', 'ZIP 条目包含绝对路径、非规范字符或分隔符', 1);
  for (const part of name.split('/')) requireThat(part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part), 'ZIP_PATH', 'ZIP 条目路径越界或包含平台保留名称', 1);
}
export async function readZip(file: string): Promise<Map<string, Buffer>> {
  const stat = await fs.lstat(file).catch(() => { throw new RetouchError('ZIP_NOT_FOUND', 'ZIP 文件不存在'); });
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= ZIP_LIMITS.archive, 'ZIP_SIZE', 'ZIP 必须是非链接文件且不超过 256 MiB', 1);
  const bytes = await fs.readFile(file);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) { reject(new RetouchError('ZIP_INVALID', 'ZIP 目录损坏或格式无效', 1)); return; }
      const entries = new Map<string, Buffer>(), names = new Set<string>(); let total = 0, count = 0, failed = false;
      const fail = (error: unknown) => { if (!failed) { failed = true; zip.close(); reject(error instanceof RetouchError ? error : new RetouchError('ZIP_INVALID', 'ZIP 内容无法完整读取', 1)); } };
      zip.on('error', fail);
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          zipPath(entry.fileName);
          requireThat(!names.has(entry.fileName.toLowerCase()), 'ZIP_COLLISION', 'ZIP 包含重复或大小写碰撞条目：' + entry.fileName, 1); names.add(entry.fileName.toLowerCase());
          requireThat((entry.externalFileAttributes >>> 16 & 0o170000) !== 0o120000 && (entry.externalFileAttributes >>> 16 & 0o170000) !== 0o040000 && !(entry.externalFileAttributes & 0x10), 'ZIP_LINK', 'ZIP 不接受符号链接或目录条目', 1);
          requireThat(!entry.isEncrypted() && [0, 8].includes(entry.compressionMethod), 'ZIP_UNSUPPORTED', 'ZIP 包含加密或不支持的压缩算法', 1);
          count++; total += entry.uncompressedSize;
          requireThat(count <= ZIP_LIMITS.entries && Number.isSafeInteger(entry.uncompressedSize) && entry.uncompressedSize <= ZIP_LIMITS.entry && total <= ZIP_LIMITS.expanded && entry.uncompressedSize <= Math.max(1024 * 1024, entry.compressedSize * ZIP_LIMITS.ratio), 'ZIP_LIMIT', 'ZIP 条目数量、解压大小或压缩比超限', 1);
          const stream = await new Promise<NodeJS.ReadableStream>((ok, bad) => zip.openReadStream(entry, (error, stream) => error || !stream ? bad(error) : ok(stream)));
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of stream) { const buffer = Buffer.from(chunk); size += buffer.length; requireThat(size <= entry.uncompressedSize && size <= ZIP_LIMITS.entry, 'ZIP_LIMIT', 'ZIP 实际解压内容超出声明大小', 1); chunks.push(buffer); }
          requireThat(size === entry.uncompressedSize, 'ZIP_TRUNCATED', 'ZIP 条目长度不符', 1);
          entries.set(entry.fileName, Buffer.concat(chunks)); if (!failed) zip.readEntry();
        })().catch(fail);
      });
      zip.on('end', () => { if (!failed) resolve(entries); });
      zip.readEntry();
    });
  });
}
export async function writeZip(file: string, entries: Map<string, Buffer>): Promise<void> {
  const zip = new yazl.ZipFile();
  const output = createWriteStream(file, { flags: 'wx' });
  const finished = pipeline(zip.outputStream, output);
  try {
    for (const [name, bytes] of entries) { zipPath(name); requireThat(bytes.length <= ZIP_LIMITS.entry, 'ZIP_LIMIT', 'ZIP 条目超限'); zip.addBuffer(bytes, name, { mtime: new Date('2026-01-01T00:00:00Z'), mode: 0o100644, compress: true }); }
    zip.end(); await finished;
  } catch (error) { (zip.outputStream as import('node:stream').Readable).destroy(); output.destroy(); await finished.catch(() => {}); throw error; }
}
