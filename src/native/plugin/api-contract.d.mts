export const API_PROFILE_SCHEMA: string;
export const API_PROTOCOL: string;
export interface ApiProfile {
  schema: string;
  protocol: string;
  base_env: string;
  credential_env: string;
  model: string;
  size: "auto" | "1024x1024" | "1536x1024" | "1024x1536";
  quality: "auto" | "low" | "medium" | "high";
  timeout_ms: number;
  response_limit_bytes: number;
  allow_loopback_http: boolean;
  private_http?: { enabled: true; confirmation: string };
  configuration_source?: {
    kind: "codex-model";
    authorized: boolean;
    authorization_ref?: string;
    workspace_id?: string;
    provider?: string;
  };
}
export function apiProfile(value: unknown): ApiProfile;
export function apiEndpoint(value: string, profile: ApiProfile): string;
export function apiPrompt(
  step: any,
  requirements: any[],
  preserve: string[],
): string;
