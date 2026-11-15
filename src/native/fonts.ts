import fs from "node:fs/promises";
import { requireThat, RetouchError } from "../domain/model.ts";
// Read the font's own family and cmap so missing fonts/glyphs never silently substitute.
export function fontInfo(bytes: Buffer) {
  try {
    requireThat(
      bytes.length >= 12 &&
        [0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(0)),
      "FONT_FORMAT",
      "只支持单字体TTF/OTF",
    );
    const count = bytes.readUInt16BE(4),
      tables = new Map<string, { offset: number; length: number }>();
    requireThat(
      count > 0 && count < 128 && 12 + count * 16 <= bytes.length,
      "FONT_FORMAT",
      "字体目录损坏",
    );
    for (let i = 0; i < count; i++) {
      const p = 12 + i * 16,
        offset = bytes.readUInt32BE(p + 8),
        length = bytes.readUInt32BE(p + 12);
      requireThat(offset + length <= bytes.length, "FONT_FORMAT", "字体表越界");
      tables.set(bytes.toString("ascii", p, p + 4), { offset, length });
    }
    const names = tables.get("name"),
      cmap = tables.get("cmap");
    requireThat(names && cmap, "FONT_FORMAT", "字体缺少名称或字符表");
    const n = names.offset,
      strings = n + bytes.readUInt16BE(n + 4),
      records = bytes.readUInt16BE(n + 2),
      families: { priority: number; value: string }[] = [];
    for (let i = 0; i < records; i++) {
      const p = n + 6 + i * 12,
        platform = bytes.readUInt16BE(p),
        name = bytes.readUInt16BE(p + 6),
        length = bytes.readUInt16BE(p + 8),
        offset = strings + bytes.readUInt16BE(p + 10);
      if (![1, 16].includes(name) || offset + length > n + names.length)
        continue;
      const raw = Buffer.from(bytes.subarray(offset, offset + length));
      const value =
        platform === 0 || platform === 3
          ? raw.length % 2
            ? ""
            : raw.swap16().toString("utf16le")
          : raw.toString("latin1");
      if (value.trim())
        families.push({
          priority: (name === 16 ? 10 : 0) + (platform === 3 ? 2 : 0),
          value: value.trim(),
        });
    }
    const family = families.sort((a, b) => b.priority - a.priority)[0]?.value;
    requireThat(family, "FONT_FORMAT", "无法读取字体内部family");
    const cm = cmap.offset,
      subtables: number[] = [];
    for (let i = 0; i < bytes.readUInt16BE(cm + 2); i++) {
      const offset = cm + bytes.readUInt32BE(cm + 4 + i * 8 + 4);
      if (offset + 2 < cm + cmap.length) subtables.push(offset);
    }
    function hasGlyph(cp: number) {
      for (const start of subtables) {
        const format = bytes.readUInt16BE(start);
        if (format === 12) {
          const groups = bytes.readUInt32BE(start + 12);
          for (let i = 0; i < groups; i++) {
            const p = start + 16 + i * 12,
              first = bytes.readUInt32BE(p),
              last = bytes.readUInt32BE(p + 4);
            if (cp >= first && cp <= last)
              return bytes.readUInt32BE(p + 8) + (cp - first) !== 0;
          }
        }
        if (format === 4 && cp <= 65535) {
          const count = bytes.readUInt16BE(start + 6) / 2,
            ends = start + 14,
            starts = ends + count * 2 + 2,
            deltas = starts + count * 2,
            ranges = deltas + count * 2;
          for (let i = 0; i < count; i++)
            if (
              cp >= bytes.readUInt16BE(starts + i * 2) &&
              cp <= bytes.readUInt16BE(ends + i * 2)
            ) {
              const delta = bytes.readInt16BE(deltas + i * 2),
                range = bytes.readUInt16BE(ranges + i * 2);
              if (!range) return ((cp + delta) & 65535) !== 0;
              const g = bytes.readUInt16BE(
                ranges +
                  i * 2 +
                  range +
                  (cp - bytes.readUInt16BE(starts + i * 2)) * 2,
              );
              return g !== 0 && ((g + delta) & 65535) !== 0;
            }
        }
      }
      return false;
    }
    return {
      family,
      assertText(text: string) {
        for (const char of text) {
          const cp = char.codePointAt(0)!;
          if ([9, 10, 13, 32].includes(cp)) continue;
          requireThat(
            hasGlyph(cp),
            "FONT_GLYPH",
            "指定字体不含所需字符：U+" + cp.toString(16).toUpperCase(),
          );
        }
      },
    };
  } catch (e) {
    if (e instanceof RetouchError) throw e;
    throw new RetouchError("FONT_FORMAT", "字体表损坏或不受支持");
  }
}
export async function readFont(file: string) {
  const stat = await fs.lstat(file).catch(() => {
    throw new RetouchError("FONT_MISSING", "指定字体文件不存在");
  });
  requireThat(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size <= 16 * 1024 * 1024,
    "FONT_FILE",
    "字体须为非链接TTF/OTF文件且不超过16MiB",
  );
  const bytes = await fs.readFile(file);
  return { bytes, ...fontInfo(bytes) };
}
