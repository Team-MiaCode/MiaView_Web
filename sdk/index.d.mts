export interface Resolution {
  readonly width: number;
  readonly height: number;
}
export type PvTimeout = number | "unlimited";
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
  pvTimeoutMs: PvTimeout;
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
export interface PerformanceMetric {
  count: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  sampledCount: number;
}
export interface PerformanceReport {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  durationMs: number;
  ready: boolean;
  loaded: boolean;
  logKind?: "initialization" | "performance";
  phase?: "engine-load" | "engine-init" | "chart-load" | "ready" | "error";
  errors?: Array<{ stage: string; message: string }>;
  loadingSteps?: Array<{
    kind: string;
    resource: string;
    loadId: number;
    startMs: number;
    durationMs: number;
    endMs: number;
    status: "ok" | "timeout" | "cancelled" | "error";
    byteSize?: number;
  }>;
  playing: boolean;
  visible: boolean;
  currentTime: number;
  difficultyId: number | null;
  noteCount: number;
  resolution: Resolution;
  maxFps: MaxFps;
  pvTimeoutMs: PvTimeout;
  hasVideo: boolean;
  videoPipeline: "browser-compositor" | "none";
  videoWidth: number;
  videoHeight: number;
  videoDecodedFrames: number | null;
  videoDroppedFrames: number | null;
  wasmHeapBytes: number;
  presentedFrames: number;
  presentedFps: number;
  playerVersion: string | null;
  sourceRevision: string | null;
  settings: PreviewSettings | null;
  /** Present on live events after backend delivery; exported history contains raw samples. */
  backendLog?: {
    ok: boolean;
    text?: string;
    terminalEnabled?: boolean;
    fileEnabled?: boolean;
    message?: string;
  };
  metrics: Record<string, PerformanceMetric>;
  counters: Record<string, number>;
}
export interface DiagnosticsSnapshot {
  schemaVersion: 1;
  enabled: boolean;
  startedAt: string;
  historyLimit: number;
  reports: PerformanceReport[];
  definitions: Record<string, string>;
}
export interface PreviewOptions {
  /** Initial player theme; default dark. The player also provides a theme toggle. */
  theme?: "dark" | "light";
  /** Initialization/load logs and playback-only performance reports sent to the renderer backend. Default true. */
  diagnostics?: boolean;
  resolution?: Resolution;
  /** Integer >= 30, or "unlimited" to follow browser refresh cadence. Default 60. */
  maxFps?: MaxFps;
  /** PV download, integrity verification and first frame preparation deadline. Integer ms >= 10000, or "unlimited". Default 30000. */
  pvTimeoutMs?: PvTimeout;
  /** Defaults to ../renderer/index.html relative to the SDK module. */
  rendererUrl?: string;
  /** Startup and command timeout; default 120000 ms. Load/difficulty changes allow pvTimeoutMs plus this timeout; unlimited PV disables their command deadline. */
  timeoutMs?: number;
}
export interface PreviewEvents {
  performance: PerformanceReport;
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
  getDiagnostics(): Promise<DiagnosticsSnapshot>;
  resetDiagnostics(): Promise<DiagnosticsSnapshot>;
  setDiagnostics(enabled: boolean): Promise<DiagnosticsSnapshot>;
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
