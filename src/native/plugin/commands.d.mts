export const SCHEMA: string;
export const stable: (value: any) => string;
export const digest: (value: any) => string;
export function documentSeries(artifact: any, artifacts: any[]): any[];
export function documentDescriptor(artifact: any, artifacts: any[]): any;
export function pendingExecution(artifact: any, artifacts: any[]): boolean;
export const tags: (value: any) => string[];
export function check(
  ok: any,
  code: string,
  message: string,
  rc?: number,
): void;
export function validateSnapshot(snapshot: any): any;
export function assertNoCredentials(value: any, key?: string): void;
export function run(...args: any[]): Promise<number>;
