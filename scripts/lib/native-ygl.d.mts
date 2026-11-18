export function writeNativeReport(
  kind: string,
  report: any,
  options?: { directory?: string },
): Promise<{ path: string; sha256: string; bytes: number }>;
export function captureNode(
  args: string[],
  options: {
    cwd: string;
    logRoot: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxJsonBytes?: number;
  },
): Promise<any>;
export function nativeReceiptPassed(
  result: any,
  options?: { doctor?: boolean },
): boolean;
export function nativeClient(
  entry: string,
  options: { home: string; cwd: string; session: string; logRoot?: string },
): Promise<{
  binding: any;
  call: (args: string[]) => Promise<any>;
  log_root: string;
}>;
