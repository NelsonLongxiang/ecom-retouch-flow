import crypto from 'node:crypto';

export type Executor = 'host' | 'offline';
export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export class RetouchError extends Error {
  code: string;
  exitCode: number;
  effectStatus: 'none' | 'submitted' | 'unknown' | 'committed';
  details: unknown;
  constructor(code: string, message: string, exitCode = 1, details: unknown = null, effectStatus: RetouchError['effectStatus'] = 'none') {
    super(message); this.name = 'RetouchError'; this.code = code; this.exitCode = exitCode; this.details = details; this.effectStatus = effectStatus;
  }
}
export function requireThat(value: unknown, code: string, message: string, exitCode = 2): asserts value {
  if (!value) throw new RetouchError(code, message, exitCode);
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, entry]) => JSON.stringify(key) + ':' + stable(entry)).join(',') + '}';
  return JSON.stringify(value);
}
export const hash = (value: unknown) => crypto.createHash('sha256').update(stable(value)).digest('hex');
export const bytesHash = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');
export const id = (prefix: string) => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
export const now = () => new Date().toISOString();

export interface Rect { x: number; y: number; width: number; height: number }
export interface Requirement { id: string; label: string; text: string; disabled: boolean; scope: 'operation' | 'preserve' | 'reference' }
export const active = (group: Requirement) => group.text.trim() !== '' && !group.disabled;
export interface Asset { id: string; sha256: string; mime: string; width: number; height: number; bytes: number; object_path: string; created_at: string }
export interface Task {
  id: string; title: string; brief: string; original_asset_id: string; working_asset_id: string;
  requirements: Requirement[]; requirements_hash: string; plan_revision: number; active_plan: string | null; active_run: string | null; created_at: string;
}
export interface Step {
  id: string; name: string; operation: 'image.edit'; input: string; needs: string[]; requirement_ids: string[];
  reference_asset_ids: string[]; region: Rect; prompt: string; offline?: { kind: 'fill'; rgba: [number, number, number, number] };
}
export interface Plan {
  schema_version: 'retouch.plan/v1'; hash: string; task_id: string; revision: number; title: string; executor: Executor;
  requirements_hash: string; original_asset_id: string; working_asset_id: string; steps: Step[]; created_at: string;
}
export interface Grant {
  id: string; task_id: string; plan_hash: string; executor: Executor; asset_sha256: string;
  issuer: 'human' | 'host-human' | 'demo'; confirmation: string; expires_at: string; delivery_root: string; max_runs: 1; created_at: string;
}
export interface Run {
  id: string; task_id: string; plan_hash: string; status: 'running' | 'waiting_for_host' | 'waiting_for_step_review' | 'unknown' | 'failed' | 'waiting_for_review' | 'accepted' | 'delivering' | 'completed' | 'cancelled';
  grant_id: string; completed_steps: Record<string, string>; current_attempt: string | null;
  accepted_asset_id: string | null; delivery: { directory: string; asset_id: string; manifest_sha256: string } | null; created_at: string;
  pending_delivery: { request_id: string; intent_hash: string; directory: string; manifest: Record<string, unknown> } | null;
}
export interface Attempt {
  id: string; run_id: string; task_id: string; step_id: string; request_id: string; intent_hash: string;
  input_asset_id: string; plan_hash: string; executor: Executor;
  status: 'prepared' | 'waiting_for_host' | 'waiting_for_review' | 'received' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  output_asset_id: string | null; raw_output_asset_id: string | null; report: QualityReport | null; request_path: string; created_at: string; owner_pid: number | null;
}
export interface QualityReport {
  input_sha256: string; output_sha256: string; region: Rect; dimensions_match: boolean; outside_region_unchanged: boolean;
  changed_inside_pixels: number; changed_outside_pixels: number; hard_verdict: Verdict;
  semantic_verdict: Verdict; semantic_observations: string; reviewer: string; scope: 'offline-demo' | 'host-image';
}
export interface YglBinding { entry: string; version: string; source_hashes: Record<string, string> }
export interface WorkspaceConfig { schema_version: 'retouch.workspace/v1'; id: string; mode: 'standard' | 'demo'; ygl: YglBinding; created_at: string }
export interface Entity<T> { revision: number; data: T }
export interface Result { result_status: string; data: Record<string, unknown>; next_actions?: { type: string; reason: string; [key: string]: unknown }[]; warnings?: string[]; replayed?: boolean }
