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
    purpose?: "node" | "os-diagnostic";
    timeoutMs?: number;
    maxJsonBytes?: number;
  },
): Promise<any>;
export function inspectManagedProcess(directory: string): Promise<{
  status: "UNKNOWN" | "INVALID" | "CLOSED";
  live_state: "NOT_OBSERVED";
  reason?: string;
  exit_code?: number | null;
  signal?: string | null;
  [key: string]: unknown;
}>;
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
