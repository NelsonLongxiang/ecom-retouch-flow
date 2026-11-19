export function suiteView(snapshot: any, artifacts: any[]): any;
export function meta(artifact: any): Record<string, any>;
export function latest(artifacts: any[], role: string, task?: string): any;
export function assertPostprocessOutput(
  execution: any,
  image: any,
  artifacts: any[],
): void;

export function invariants(value: any, artifacts: any[]): any;
export function inspectionItems(items: any[], definitions: any[]): any[];
export function invariantView(artifacts: any[], image: any, task: any): any;
export function assertInvariants(artifacts: any[], image: any, task: any): any;
