export const correctionConfirmation: string;
export function assertCorrectionOutputAttachment(
  executionId: string,
  outputs: string[] | undefined,
  artifacts: any[],
): void;
export function assertCorrectionWorkspace(
  body: any,
  manager: any,
): Promise<any>;
export function validateCorrectionReferences(
  subject: any,
  artifacts: any[],
  digest: (value: any) => string,
): boolean;
export function correctionPlan(
  body: any,
  execution: any,
  image: any,
  task: any,
  source: any,
  artifacts: any[],
  digest: (value: any) => string,
): any;
export function correctReceivedOutput(body: any, helpers: any): Promise<any>;
export function validateCorrectionAudit(
  artifact: any,
  artifacts: any[],
  digest: (value: any) => string,
): boolean;
