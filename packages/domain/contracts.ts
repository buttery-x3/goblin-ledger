export type Mode = "live" | "demo";
export type Region = "eu" | "us";
export interface ProfileSelection {
  mode: Mode;
  region: Region | null;
}
export function profileKey(profile: ProfileSelection): string {
  return profile.mode + ":" + (profile.region ?? "-");
}

export interface Bootstrap extends ProfileSelection {
  token: string;
  freshness: number | null;
  workspace: Record<string, unknown> | null;
  routes: { id: string; name: string; zone: string }[];
}
