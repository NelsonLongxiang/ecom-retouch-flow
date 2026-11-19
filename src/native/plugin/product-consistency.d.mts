export function productConsistency(
  value: any,
  items: any[],
  artifacts: any[],
  historical?: boolean,
): any;
export function productPlan(
  artifacts: any[],
  steps: any[],
  purpose: string,
  taskId: string,
  inputId: string,
  historical?: boolean,
): any;
export function assertProductRequest(
  plan: any,
  step: any,
  input: any,
  references: any[],
  artifacts: any[],
): any;
export function productComposite(
  operation: any,
  base: any,
  artifacts: any[],
  historical?: boolean,
): any;
export function renderProductComposite(
  baseBytes: Buffer,
  operation: any,
  base: any,
  artifacts: any[],
  load: (artifact: any) => Promise<Buffer>,
  historical?: boolean,
): Promise<Buffer>;
export function productProtection(artifacts: any[], image: any, task: any): any;
export function verifyProductTransform(
  root: string,
  artifacts: any[],
  execution: any,
  image: any,
  options?: { historical?: boolean; load?: (artifact: any) => Promise<Buffer> },
): Promise<any>;
export function verifyProductPixels(
  root: string,
  artifacts: any[],
  image: any,
  task: any,
): Promise<any>;
