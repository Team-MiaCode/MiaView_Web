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
  filePath?: string;
}
export interface DocumentSnapshot {
  sourceText: string; chartText: string; filePath: string;
  activeDifficultyId: number; revision: number; dirty: boolean; metadataDirty: boolean;
  hasDocument: boolean; dirtyDifficultyIds: number[]; documentOpenGeneration: number;
  title: string; artist: string; designer: string; first: string;
  metadataTitle: string; metadataArtist: string; metadataDesigner: string; metadataFirst: string;
  metadataClockCount: string; metadataExtraText: string; metadataVideoPath: string;
  currentDifficultyLevel: string; currentDifficultyDesigner: string; currentDifficultyOffset: string;
  unifiedDesignerEnabled: boolean;
  charts: Array<{ id: number; level: string; designer: string; hasChart: boolean }>;
  designerSlots: Array<{ id: number; name: string; designer: string; hasChart: boolean }>;
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
export interface PlaybackSettings {
  rate: number;
  rangePlaybackEnabled: boolean;
  exportStartSeconds: number;
  exportEndSeconds: number;
}
export interface TimelineOptions extends Resolution {
  colors: Record<string, string | [number, number, number, number]>;
  noteSkin?: "DX" | "SD";
  zoomScale?: number;
  contentScale?: number;
  horizontalScrollValue?: number;
  playbackEntrySeconds?: number;
  playheadSeconds?: number;
  cursorSeconds?: number;
  showSlideTracks?: boolean;
  waveformBrightness?: number;
  measureLineBrightness?: number;
  waveformPhaseCompensationSeconds?: number;
  headerLeftLimit?: number;
  headerRightLimit?: number;
}
export interface TimelineFollowState { active: boolean; start?: number; end?: number; caret?: number; second?: number; }
export interface TimelinePoint { x: number; y: number; }
export interface TimelineRect extends TimelinePoint { width: number; height: number; }
export interface TimelineLine { start: TimelinePoint; end: TimelinePoint; color: string; width: number; }
export interface TimelineRectangle { rect: TimelineRect; color: string; }
export interface TimelineTriangle { a: TimelinePoint; b: TimelinePoint; c: TimelinePoint; color: string; }
export interface TimelineLabel { text: string; topLeft: TimelinePoint; color: string; font: { family: string; pixelSize: number; ascent: number }; }
export interface TimelineSprite { center: TimelinePoint; spriteType: string; scale: number; rotationDegrees: number; mirrorX: boolean; imageKey: string; }
export interface TimelineHoldSpan { startX: number; endX: number; rowTop: number; laneHeight: number; spriteType: string; baseIconScale: number; leftKey: string; rightKey: string; bodyKey: string; }
export interface TimelineGlyph { rect: TimelineRect; shape: number; fillColor: string; strokeColor: string; strokeWidth: number; radius: number; tooltipText: string; }
export interface TimelineSceneState {
  viewportSize: Resolution;
  timelineLeft: number; timelineTop: number; timelineHeight: number; laneHeight: number; laneCount: number;
  horizontalScrollValue: number; contentWidth: number; displayStartSeconds: number; pixelsPerSecond: number; leadingCenteringPadding: number; maxNavigableSecond: number;
  baseBackgroundRects: TimelineRectangle[]; laneOverlayRects: TimelineRectangle[]; waveformBars: TimelineRectangle[]; gridLines: TimelineLine[];
  frameRects: TimelineRectangle[]; frameLines: TimelineLine[]; laneLabels: TimelineLabel[]; headerLabels: TimelineLabel[]; headerMarkers: TimelineTriangle[];
  fireworkBands: TimelineRectangle[]; trackLines: TimelineLine[]; touchHoldLines: TimelineLine[];
  noteSprites: TimelineSprite[]; trackSprites: TimelineSprite[]; holdSpans: TimelineHoldSpan[]; muriDots: TimelineGlyph[];
  images: Record<string, { url: string; width: number; height: number }>;
  hasEntryMarker: boolean; entryMarker: TimelineTriangle; hasCursorMarker: boolean; cursorMarker: TimelineTriangle;
  hasCursorLine: boolean; cursorLine: TimelineLine; hasPlayheadLine: boolean; playheadLine: TimelineLine; hasDragCenterLine: boolean; dragCenterLine: TimelineLine;
}
export interface CoverLayer {
  key: string;
  kind: "card" | "chartFrame" | "image" | "text";
  nx: number;
  ny: number;
  sizeFraction: number;
  z: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  label?: string;
  text?: string;
  textColor?: string;
  textBold?: boolean;
  fontPath?: string;
  imagePath?: string;
  frameSeconds?: number;
  frameBgMode?: "image" | "transparent" | "pv" | "pvFit";
  frameBgBrightness?: number;
  frameBgTransparency?: number;
}
export interface CoverComposition {
  layout?: { layers: CoverLayer[] };
  outputWidth?: number;
  outputHeight?: number;
  activeLayerKey?: string;
  trackOverrides?: Record<string, string | number | boolean>;
  jacketImage?: string;
  backgroundImage?: string;
  backgroundMode?: 0 | 1 | 2;
  blurEnabled?: boolean;
  coverBgBrightness?: number;
  cardShadowEnabled?: boolean;
  coverTemplate?: Record<string, unknown>;
}
export interface CoverCompositionState {
  layout: { layers: CoverLayer[] };
  activeLayerKey: string;
  outputWidth: number;
  outputHeight: number;
}
export interface NoteStatistic {
  kind: "tap" | "hold" | "slide" | "touch" | "break" | "total";
  played: number;
  total: number;
  value: string;
}
export interface PreviewState {
  statistics: NoteStatistic[];
  statisticsAvailable: boolean;
  playback: PlaybackSettings;
  media: { hidePv: boolean };
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
  theme?: "dark" | "light" | "legacy" | "legacy_light";
  /** Intrinsic aspect ratio, or fill a workbench container with its own height. */
  layout?: "intrinsic" | "fit";
  /** Render the built-in transport; default true. A workbench can supply its own controls. */
  controls?: boolean;
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
  documentChanged: DocumentSnapshot;
  performance: PerformanceReport;
  ready: { playerVersion: string; sourceRevision: string };
  progress: { stage: string; progress: number };
  playing: { elapsedMs: number };
  paused: { elapsedMs: number };
  ended: { elapsedMs: number };
  error: { code: string; message: string; elapsedMs?: number };
  seeked: { currentTime: number };
  settingsChanged: PreviewState["settings"];
  playbackChanged: PlaybackSettings;
  timeupdate: { currentTime: number; duration: number; playing: boolean; rate: number; statistics: NoteStatistic[]; statisticsAvailable: boolean };
  coverChanged: CoverCompositionState;
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
  setTheme(theme: NonNullable<PreviewOptions["theme"]>): Promise<NonNullable<PreviewOptions["theme"]>>;
  setPlayback(settings: Partial<PlaybackSettings>): Promise<PlaybackSettings>;
  setMediaSettings(settings: { hidePv: boolean }): Promise<{ hidePv: boolean }>;
  setCanvasSize(size: Resolution): Promise<Resolution>;
  getTimeline(options: TimelineOptions): Promise<TimelineSceneState>;
  navigateTimeline(point: TimelinePoint): Promise<{ second: number; line: number; column: number; position: number; resolved: boolean }>;
  getTimelineFollow(second: number): Promise<TimelineFollowState>;
  getDocument(): Promise<DocumentSnapshot>;
  documentCommand(id: string, args?: Record<string, unknown>): Promise<{ accepted: boolean; document: DocumentSnapshot; previewError?: string }>;
  getDocumentSaveText(section?: number): Promise<{ sourceText: string; revision: number }>;
  setCoverComposition(composition: CoverComposition): Promise<CoverCompositionState>;
  getCoverComposition(): Promise<CoverCompositionState>;
  selectDifficulty(difficulty: number): Promise<ChartInfo | DocumentSnapshot>;
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
