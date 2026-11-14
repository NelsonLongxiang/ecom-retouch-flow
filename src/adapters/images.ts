import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { bytesHash, now, requireThat, RetouchError, type Asset, type QualityReport, type Rect, type Step, type Verdict } from '../domain/model.ts';
import type { Store } from '../infrastructure/store.ts';

export class Images {
  store: Store;
  constructor(store: Store) { this.store = store; }
  async file(file: string): Promise<Buffer> {
    requireThat(!/^[a-z][a-z0-9+.-]*:\/\//i.test(file), 'LOCAL_FILE_REQUIRED', '只接收本地实际图像文件');
    const stat = await fs.stat(file).catch(() => { throw new RetouchError('IMAGE_NOT_FOUND', '图像文件不存在'); });
    requireThat(stat.isFile() && stat.size > 0 && stat.size <= 32 * 1024 * 1024, 'IMAGE_SIZE', '图像须为非空且不超过 32 MiB 的文件');
    return fs.readFile(file);
  }
  async metadata(bytes: Buffer): Promise<{ width: number; height: number; mime: string }> { return Images.metadata(bytes); }
  static async metadata(bytes: Buffer): Promise<{ width: number; height: number; mime: string }> {
    try {
      const metadata = await sharp(bytes, { limitInputPixels: 50_000_000, failOn: 'warning' }).metadata();
      requireThat(['png', 'jpeg', 'webp'].includes(metadata.format ?? '') && (metadata.pages ?? 1) === 1 && metadata.width && metadata.height, 'IMAGE_FORMAT', '支持单帧 PNG、JPEG、WebP');
      await sharp(bytes, { limitInputPixels: 50_000_000, failOn: 'warning' }).raw().toBuffer();
      return { width: metadata.width, height: metadata.height, mime: 'image/' + (metadata.format === 'jpeg' ? 'jpeg' : metadata.format) };
    } catch (error) { if (error instanceof RetouchError) throw error; throw new RetouchError('IMAGE_DECODE', '图像无法解码', 2); }
  }
  async register(bytes: Buffer): Promise<Asset> {
    const metadata = await this.metadata(bytes), sha256 = bytesHash(bytes), assetId = 'asset_' + sha256;
    const existing = this.store.maybe<Asset>('asset', assetId);
    if (existing) { await this.store.assetBytes(assetId); return existing.data; }
    const file = await this.store.object(bytes);
    const asset: Asset = { id: assetId, sha256, ...metadata, bytes: bytes.length, object_path: path.relative(this.store.root, file).replaceAll('\\', '/'), created_at: now() };
    this.store.transaction(() => { if (!this.store.maybe('asset', assetId)) this.store.insert('asset', assetId, asset); });
    return this.store.get<Asset>('asset', assetId).data;
  }
  async import(file: string): Promise<{ original: Asset; working: Asset }> {
    const bytes = await this.file(file);
    const original = await this.register(bytes);
    const canonical = await sharp(bytes, { limitInputPixels: 50_000_000 }).rotate().toColourspace('srgb').ensureAlpha().png().toBuffer();
    const working = await this.register(canonical);
    this.store.transaction(() => this.store.event('asset.normalized', { original: original.id, working: working.id, transform: 'exif-auto-orient/srgb/rgba/png-v1' }));
    return { original, working };
  }
  async regionFiles(inputId: string, region: Rect): Promise<{ mask: Asset; preview: Asset }> {
    const input = this.store.get<Asset>('asset', inputId).data;
    const mask = Buffer.alloc(input.width * input.height);
    for (let y = region.y; y < region.y + region.height; y++) mask.fill(255, y * input.width + region.x, y * input.width + region.x + region.width);
    const maskAsset = await this.register(await sharp(mask, { raw: { width: input.width, height: input.height, channels: 1 } }).png().toBuffer());
    const overlay = await sharp({ create: { width: region.width, height: region.height, channels: 4, background: { r: 240, g: 80, b: 30, alpha: 0.4 } } }).png().toBuffer();
    const preview = await this.register(await sharp(await this.store.assetBytes(inputId)).composite([{ input: overlay, left: region.x, top: region.y }]).png().toBuffer());
    return { mask: maskAsset, preview };
  }
  async fill(inputId: string, step: Step): Promise<Asset> {
    requireThat(step.offline, 'MISSING_OFFLINE_OPERATION', '缺少离线操作', 1);
    const { data, info } = await sharp(await this.store.assetBytes(inputId)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const region = step.region;
    for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
      const offset = (y * info.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) data[offset + channel] = step.offline.rgba[channel];
    }
    return this.register(await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
  }
  async composite(inputId: string, generatedId: string, region: Rect): Promise<Asset> {
    const input = this.store.get<Asset>('asset', inputId).data, generated = this.store.get<Asset>('asset', generatedId).data;
    requireThat(input.width === generated.width && input.height === generated.height, 'OUTPUT_DIMENSIONS', '宿主结果必须保持工作图尺寸', 1);
    const original = await sharp(await this.store.assetBytes(inputId)).ensureAlpha().raw().toBuffer();
    const edited = await sharp(await this.store.assetBytes(generatedId)).ensureAlpha().raw().toBuffer();
    for (let y = region.y; y < region.y + region.height; y++) {
      const start = (y * input.width + region.x) * 4;
      edited.copy(original, start, start, start + region.width * 4);
    }
    return this.register(await sharp(original, { raw: { width: input.width, height: input.height, channels: 4 } }).png().toBuffer());
  }
  async compare(inputId: string, outputId: string, region: Rect, semantic: Verdict, observations: string, reviewer: string, demo: boolean): Promise<QualityReport> {
    const input = this.store.get<Asset>('asset', inputId).data, output = this.store.get<Asset>('asset', outputId).data;
    const matches = input.width === output.width && input.height === output.height;
    let changedInside = 0, changedOutside = 0;
    if (matches) {
      const left = await sharp(await this.store.assetBytes(inputId)).toColourspace('srgb').ensureAlpha().raw().toBuffer();
      const right = await sharp(await this.store.assetBytes(outputId)).toColourspace('srgb').ensureAlpha().raw().toBuffer();
      for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
        const at = (y * input.width + x) * 4;
        let different = false;
        for (let channel = 0; channel < 4; channel++) if (left[at + channel] !== right[at + channel]) different = true;
        if (different) { if (x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height) changedInside++; else changedOutside++; }
      }
    }
    return { input_sha256: input.sha256, output_sha256: output.sha256, region, dimensions_match: matches, outside_region_unchanged: matches && changedOutside === 0,
      changed_inside_pixels: changedInside, changed_outside_pixels: changedOutside, hard_verdict: matches && changedOutside === 0 && changedInside > 0 ? 'PASS' : 'FAIL',
      semantic_verdict: semantic, semantic_observations: observations, reviewer, scope: demo ? 'offline-demo' : 'host-image' };
  }
}
