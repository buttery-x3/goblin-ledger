export type Mode = 'live' | 'demo';
export type Region = 'eu' | 'us';
export interface ProfileSelection { mode: Mode; region: Region | null }
export interface SourceEvidence {
  provider: string;
  house: string;
  observedAt: number;
  retrievedAt: number;
  method: string;
}
export interface Bootstrap extends ProfileSelection {
  token: string;
  workspace: Record<string, unknown> | null;
  routes: { id: string; name: string; zone: string }[];
}
export type CopperTotal = string; // Exact integer encoded as decimal text across HTTP.
