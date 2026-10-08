export interface Resolution {
  readonly width: number;
  readonly height: number;
}
export type MaxFps = number | "unlimited";
export interface UrlResource {
  url: string;
  contentType?: string;
  byteSize?: number;
  sha256?: string;
}
export type Resource = string | Blob | UrlResource;
export interface ChartInput {
  /** A string is raw maidata text. Use { url } to load maidata from a URL. */
  maidata: Resource;
  audio?: Resource;
  cover?: Resource;
  video?: Resource;
  difficulty?: number | null;
}
export interface PreviewSettings {
  previewMode: "native" | "maimuri_dx_style" | "erase_by_area";
  outerBrightness: number;
  innerBrightness: number;
  tapFlowSpeed: number;
  touchFlowSpeed: number;
  earlierSlideOnTop: boolean;
  noteSkin: "SD" | "DX";
}
export interface PreviewState {
  maxFps: MaxFps;
  loaded: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  difficultyId: number | null;
  settings: PreviewSettings & { showJudgeEffects: true };
  resolution: Resolution & {
    showTimestamp: true;
    showChartInfoHud: boolean;
    showObjectStatsHud: boolean;
  };
}
export interface ChartInfo {
  title: string;
  artist: string;
  difficultyId: number;
  duration: number;
  noteCount: number;
  charts: Array<{ id: number; label: string }>;
}
export interface PreviewOptions {
  resolution?: Resolution;
  /** Integer >= 30, or "unlimited" to follow browser refresh cadence. Default 60. */
  maxFps?: MaxFps;
  /** Defaults to ../renderer/index.html relative to the SDK module. */
  rendererUrl?: string;
  /** Startup and command timeout; default 120000 ms. */
  timeoutMs?: number;
}
export interface PreviewEvents {
  ready: { playerVersion: string; sourceRevision: string };
  progress: { stage: string; progress: number };
  playing: { elapsedMs: number };
  paused: { elapsedMs: number };
  ended: { elapsedMs: number };
  error: { code: string; message: string; elapsedMs?: number };
  seeked: { currentTime: number };
  settingsChanged: PreviewState["settings"];
}
export interface MiaCodePreview {
  readonly ready: Promise<MiaCodePreview>;
  load(chart: ChartInput): Promise<ChartInfo>;
  play(): Promise<PreviewState>;
  pause(): Promise<PreviewState>;
  restart(): Promise<PreviewState>;
  seek(second: number): Promise<PreviewState>;
  setSettings(
    settings: Partial<PreviewSettings>,
  ): Promise<PreviewState["settings"]>;
  selectDifficulty(difficulty: number): Promise<ChartInfo>;
  getState(): Promise<PreviewState>;
  on<T extends keyof PreviewEvents>(
    type: T,
    listener: (payload: PreviewEvents[T]) => void,
  ): () => void;
  destroy(): void;
}
export function createPreview(
  container: HTMLElement,
  options?: PreviewOptions,
): MiaCodePreview;
export function previewResolution(value?: Resolution): Resolution;
export const DEFAULT_RESOLUTION: Resolution;
export function previewMaxFps(value?: MaxFps): MaxFps;
export const DEFAULT_MAX_FPS: number;
