export const flowReadActions: readonly string[];
export const flowActions: readonly string[];
export function flowCommand(
  action: string,
  body: any,
  helpers: any,
): Promise<any>;
