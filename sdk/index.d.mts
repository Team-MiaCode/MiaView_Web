export interface Resolution {
  readonly width: number;
  readonly height: number;
}
export type PvTimeout = number | "unlimited";
export type MaxFps = number | "unlimited";
export type FrameRateMode = 0 | 1 | 2 | 3;
export interface PerformanceSettings { canvasFrameRateMode: FrameRateMode | null; stageMediaFrameRateMode: FrameRateMode; videoDecodePrefersSoftware: boolean }
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
export interface ChartResources { audio?: Resource | null; cover?: Resource | null; video?: Resource | null; }
export interface AudioInfo {
  valid: boolean; title: string; artist: string; album: string;
  cover?: { mimeType: "image/jpeg"; base64: string }; coverError?: string;
}
export interface ShortcutGesture {
  canonicalText: string; displayText: string; key: number; modifiers: number; wheelDirection: -1 | 0 | 1;
}
export interface AppBackgroundSettings {
  enabled: boolean; imagePath: string; opacity: number; blur: number; panelAlpha: number;
  sizeMode: "cover" | "contain" | "stretch" | "center" | "repeat";
  position: "center" | "left" | "right" | "top" | "bottom" | "left_top" | "right_top" | "left_bottom" | "right_bottom";
  overlays: Record<string,number>;
}
export interface ImportedFont { path: string; family: string; sha256: string; }
export interface VideoExportOptions {
  resolutionIndex?: 0|1|2|3|4|5|6|7|8;
  width?: number; height?: number; fps?: 30|60|120;
  audioBitrateKbps?: 128|160|192|256|320;
  presetIndex?: 0|1; sizePresetIndex?: 0|1|2|3;
  format?: "auto"|"mp4"|"webm";
  exportStartSeconds?: number; exportEndSeconds?: number; clockCountEnabled?: boolean;
  showTimestamp?: boolean; showObjectStatsHud?: boolean; showChartInfoHud?: boolean;
  introEnabled?: boolean; introPvPreview?: boolean; introPvStartSeconds?: number;
  introModeIndex?: 0|1|2; introBackgroundModeIndex?: 0|1;
  introBlurBackground?: boolean; introCardShadow?: boolean; introLevelTextRender?: boolean;
  introFontDisplayPath?: string; introFontBodyPath?: string;
  introBackground?: Resource;
  /** A writable handle streams the file and commits after successful encoding. */
  fileHandle?: FileSystemFileHandle;
}
export interface VideoExportCapabilities {
  format: "mp4"|"webm"; mimeType: string; extension: ".mp4"|".webm";
  videoCodec: "avc"|"vp9"|"vp8"; audioCodec: "aac"|"opus";
  width: number; height: number; fps: 30|60|120;
}
export interface VideoExportResult extends VideoExportCapabilities {
  frameCount: number; duration: number; fileName: string|null;
  /** Present for memory exports; file-handle exports return null. */
  blob: Blob|null;
}
export interface VideoExportStatus {
  jobId: string; running: boolean; stage: "preparing"|"encoding"|"completed"|"cancelled"|"failed";
  progress: number; message?: string;
}
export interface IntroAuditionOptions extends Pick<VideoExportOptions,"introPvStartSeconds"|"introBackground"|"introBackgroundModeIndex"|"introModeIndex"|"introBlurBackground"|"introCardShadow"|"introLevelTextRender"|"introFontDisplayPath"|"introFontBodyPath"> {
  enabled?: boolean; playing?: boolean; introAuditionLoop?: boolean; elapsed?: number;
}
export interface IntroAuditionState {
  active: boolean; playing: boolean; introAuditionLoop: boolean; elapsed: number;
  duration: number; introPvStartSeconds: number;
}
export type HudFontPaths = Partial<Record<"chart_info" | "timestamp" | "center_display" | "object_stats" | "debug_info", string>>;
export interface DocumentSnapshot {
  sourceText: string; chartText: string; filePath: string;
  activeDifficultyId: number; revision: number; dirty: boolean; metadataDirty: boolean;
  hasDocument: boolean; dirtyDifficultyIds: number[]; documentOpenGeneration: number;
  title: string; artist: string; designer: string; first: string;
  metadataTitle: string; metadataArtist: string; metadataDesigner: string; metadataFirst: string;
  metadataClockCount: string; metadataExtraText: string; metadataVideoPath: string;
  currentDifficultyLevel: string; currentDifficultyDesigner: string; currentDifficultyOffset: string;
  unifiedDesignerEnabled: boolean; wholeBpm: string;
  bpm: number; clockCount: number; offsetSeconds: number;
  charts: Array<{ id: number; level: string; designer: string; hasChart: boolean; bookmarks: Array<{ line: number; title: string }> }>;
  designerSlots: Array<{ id: number; name: string; designer: string; hasChart: boolean }>;
}
export interface AnalysisRow {
  line: number; column: number; endColumn: number; second: number;
  severity: "error" | "warning"; alert?: "muri" | "warning";
  title?: string; detail: string; difficultyId: number; revision: number; documentOpenGeneration: number;
}
export interface AnalysisSnapshot {
  available: boolean; pending: boolean; revision: number; documentOpenGeneration: number; difficultyId: number;
  validationRows: AnalysisRow[]; muriRows: AnalysisRow[]; syntaxErrorCount: number; syntaxWarningCount: number;
}
export interface PreviewSettings {
  hudFontPaths?: HudFontPaths;
  previewMode: "native" | "maimuri_dx_style" | "erase_by_area";
  outerBrightness: number;
  innerBrightness: number;
  tapFlowSpeed: number;
  touchFlowSpeed: number;
  earlierSlideOnTop: boolean;
  noteSkin: "SD" | "DX";
  skinDirectoryName?: string;
  customOutlineFileName?: string;
  layoutSquareScale?: number; scaleMode?: 0 | 1 | 2 | 3;
  smoothBrightness?: boolean; showTimestamp?: boolean; showDebugInfo?: boolean;
  showChartInfoHud?: boolean; showObjectStatsHud?: boolean;
  centerDisplay?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; tapJudgeTextDistance?: 0 | 1 | 2;
  skinJudgeEffectIndex?: 0 | 1; outlineIndex?: 0 | 1 | 2 | 3;
  touchPadAuthoringShortcut?: boolean; forceLabeledJudgeLineWhenPaused?: boolean;
  pauseDisplayAltHoldActive?: boolean;
  /** Enable click authoring while the caller's chart source editor is active. */
  touchPadAuthoringContext?: boolean;
  judgeEffectSlide?: boolean; judgeEffectTap?: boolean; judgeEffectBreak?: boolean; judgeEffectTouch?: boolean;
}
export interface PlaybackSettings {
  rate: number;
  rangePlaybackEnabled: boolean;
  exportStartSeconds: number;
  exportEndSeconds: number;
}
export type AudioChannel = "global" | "track" | "answer" | "tap" | "ex" | "break" | "breakSlide" | "slide" | "touch" | "firework" | "intro";
export interface AudioSettingsSnapshot {
  channels: Record<AudioChannel, { percent: number; muted: boolean }>;
  gains: Record<string, number>;
  settings: Record<string, number | boolean>;
  breakSlideTailCheerMuted: boolean;
}
export interface LatencySettings {
  onPage: boolean; bpm: number; offsetSeconds: number; subdivision: 4 | 8 | 16; sfxVolumePercent: number;
}
export interface BpmDetectionResult {
  bpm: number; meterId: string; meterPhaseSeconds: number; candidates: Array<{ bpm: number; score: number }>;
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
  frameBgEnabled?: boolean;
  frameBgMode?: "image" | "transparent" | "pv" | "pvFit";
  frameBgBrightness?: number;
  frameBgTransparency?: number;
  frameStyle?: string;
  contentAspect?: number;
  pvFrameRevision?: number;
}
export interface CoverComposition {
  sourceText?: string;
  difficulty?: number;
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
  cardFontDisplayPath?: string;
  cardFontBodyPath?: string;
  outputFile?: string;
  coverTemplate?: Record<string, unknown>;
}
export interface CoverCompositionState {
  trackOverrides: Record<string, string | number | boolean>;
  layout: { layers: CoverLayer[] };
  activeLayerKey: string;
  outputWidth: number;
  outputHeight: number;
  composition: CoverLayoutFile;
  chartFramePlaying: boolean;
  chartFrameDuration: number;
}
export interface CoverPlaybackState { activeLayerKey: string; frameSeconds: number; chartFramePlaying: boolean; chartFrameDuration: number }
export interface CoverLayoutFile {
  kind: "miacode-cover-composition";
  version: 3;
  size: { w: number; h: number };
  background: { mode: "jacket" | "custom" | "transparent"; customPath: string; blur: boolean; brightness: number };
  card: { mode: string; shadow: boolean; levelTextRender: boolean; longText: string; fontDisplay: string; fontBody: string };
  layout: { layers: CoverLayer[] };
  outputFile?: string;
  assets?: Record<string, { name: string; type: string; data: string }>;
}
export interface SkinImageInput { path: string; image: Resource }
export interface ImportedSkin { skinDirectoryName: string; imageCount: number }
export interface ImportedJudgeLine { customOutlineFileName: string; width: number; height: number }
export interface ImportedCoverImage { path: string; url: string; sha256: string; width: number; height: number }
export interface ExportedCoverImage { blob: Blob; mimeType: "image/png" | "image/jpeg"; width: number; height: number }
export type CoverCommandId = "cover.selectLayerKey" | "cover.layer" | "cover.setLayerVisible" | "cover.setLayerLocked"
  | "cover.addTextLayer" | "cover.addImageLayer" | "cover.addChartFrameLayer" | "cover.duplicateActiveLayer"
  | "cover.removeActiveLayer" | "cover.raiseActiveLayer" | "cover.lowerActiveLayer" | "cover.moveLayer" | "cover.resetLayout" | "cover.importLayout" | "cover.toggleActiveLayerPlayback" | "cover.beginActiveLayerKeySeek" | "cover.endActiveLayerKeySeek";
export type CoverCommandArguments = Partial<Omit<CoverLayer, "kind" | "label" | "z" | "contentAspect">> & { viewRow?: number; direction?: -1 | 1; composition?: CoverLayoutFile };
export interface EditorCommandArguments {
  text: string;
  anchor?: number;
  position?: number;
  input?: string;
  key?: number;
  modifiers?: number;
  index?: number;
  glyph?: string;
  closingPresent?: boolean;
  title?: string;
  pad?: string;
  separator?: string;
  settings?: { halfWidthInputEnabled?: boolean; overwriteMode?: boolean; autoCompletionEnabled?: boolean; wholeBpm?: string };
}
export interface EditorCommandResult {
  consumed: boolean;
  error: string;
  suppressFallbackInsert: boolean;
  transaction: { hasEdit: boolean; replacementStart: number; replacementEnd: number; replacementText: string; anchor: number; position: number; touchTokenStart: number };
  completionActive: boolean;
  completionCandidates: string[];
  completionIndex: number;
}
export interface SelectionBeatSummary {
  totalCommaCount: number;
  exact: boolean;
  parts: Array<{ count: number; denominator: number }>;
}
export interface NoteStatistic {
  kind: "tap" | "hold" | "slide" | "touch" | "break" | "total";
  played: number;
  total: number;
  value: string;
}
export interface PreviewState {
  performance: PerformanceSettings;
  videoPresentation: { decoder: "software" | "browser"; frames: number; timestamp: number; requestedTime?: number; rejectedFrames?: number; pending?: boolean };
  introAudition: IntroAuditionState|null;
  exportPreview: ExportPreviewState | null;
  minimum: number;
  statistics: NoteStatistic[];
  statisticsAvailable: boolean;
  playback: PlaybackSettings;
  media: { hidePv: boolean; audioAvailable: boolean; coverAvailable: boolean; videoAvailable: boolean };
  audio: AudioSettingsSnapshot;
  latency: LatencySettings;
  maxFps: MaxFps;
  pvTimeoutMs: PvTimeout;
  loaded: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  difficultyId: number | null;
  settings: PreviewSettings;
  resolution: Resolution & {
    showTimestamp: boolean;
    showChartInfoHud: boolean;
    showObjectStatsHud: boolean;
  };
}
export interface ExportPreviewState {
  active: boolean; currentTime: number; minimum: number; duration: number; playing: boolean;
  playbackEntrySeconds: number; auditionPlaying: boolean; introPvStartSeconds: number; fps: number;
  clockCountEnabled: boolean; clockCount: number; clockBpm: number;
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
  videoPipeline: "browser-canvas" | "software-canvas" | "none";
  videoPresentedFrames: number;
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
  /** Iframe Permissions Policy; default "autoplay; fullscreen". */
  allow?: string;
  /** Iframe sandbox attributes, applied before navigation; default "allow-scripts allow-same-origin". */
  sandbox?: string;
  /** Detached same-origin previews may use their opener document's audio permission. */
  audioContextOwner?: "renderer" | "opener";
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
  introAuditionChanged: IntroAuditionState;
  exportPreviewChanged: ExportPreviewState;
  exportProgress: { jobId: string; stage: "encoding"; frame: number; frameCount: number; progress: number };
  exportCompleted: VideoExportResult & { jobId: string };
  exportFailed: { jobId: string; cancelled: boolean; message: string };
  shortcutInput: { id: string; phase: "keydown" | "keyup" };
  touchPadAuthoring: { action: { pad: string; separator: string }; difficulty: number; documentOpenGeneration: number };
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
  coverPlaybackChanged: CoverPlaybackState;
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
  /** Replace media while retaining document identity, edits and save points. */
  setResources(resources: ChartResources): Promise<PreviewState>;
  readAudioInfo(audio: Resource): Promise<AudioInfo>;
  normalizeShortcuts(sequences: Record<string, string>): Promise<Record<string, ShortcutGesture>>;
  setInputShortcuts(sequences: Record<string, string>): Promise<Record<string, ShortcutGesture>>;
  normalizeBackground(settings?: Partial<AppBackgroundSettings>): Promise<AppBackgroundSettings>;
  importFont(font: Resource, name?: string): Promise<ImportedFont>;
  getExportCapabilities(settings?: VideoExportOptions): Promise<VideoExportCapabilities>;
  setIntroAudition(settings?: IntroAuditionOptions): Promise<IntroAuditionState|null>;
  setExportPreview(settings?: VideoExportOptions & { enabled?: boolean; selectedDifficultyId?: number; stop?: boolean; cardDimmed?: boolean; introAuditionLoop?: boolean }): Promise<PreviewState>;
  /** Returns a job id; completion and progress arrive through PreviewEvents. */
  startExport(settings?: VideoExportOptions): Promise<{jobId:string}>;
  cancelExport(): Promise<{jobId:string|null}>;
  getExportStatus(): Promise<VideoExportStatus|null>;
  setCanvasSize(size: Resolution): Promise<Resolution>;
  getTimeline(options: TimelineOptions): Promise<TimelineSceneState>;
  navigateTimeline(point: TimelinePoint): Promise<{ second: number; line: number; column: number; position: number; resolved: boolean }>;
  getTimelineFollow(second: number): Promise<TimelineFollowState>;
  getDocument(): Promise<DocumentSnapshot>;
  getAnalysis(language?: string): Promise<AnalysisSnapshot>;
  documentCommand(id: string, args?: Record<string, unknown>): Promise<{ accepted: boolean; document: DocumentSnapshot; previewError?: string }>;
  getDocumentSaveText(section?: number): Promise<{ sourceText: string; revision: number }>;
  setCoverComposition(composition: CoverComposition): Promise<CoverCompositionState>;
  getCoverComposition(): Promise<CoverCompositionState>;
  setCoverChart(chart: ChartInput, options?: { duration?: number }): Promise<CoverCompositionState>;
  coverCommand(id: CoverCommandId, args?: CoverCommandArguments): Promise<CoverCompositionState>;
  importSkin(files: SkinImageInput[]): Promise<ImportedSkin>;
  importJudgeLine(image: Resource): Promise<ImportedJudgeLine>;
  importCoverImage(image: Resource): Promise<ImportedCoverImage>;
  exportCover(options?: { type?: "image/png" | "image/jpeg"; quality?: number }): Promise<ExportedCoverImage>;
  selectDifficulty(difficulty: number): Promise<ChartInfo | DocumentSnapshot>;
  editorCommand(id: "edit.selectionBeats", args: EditorCommandArguments): Promise<SelectionBeatSummary>;
  editorCommand(id: string, args: EditorCommandArguments): Promise<EditorCommandResult>;
  audioCommand(id: "audio.getSettings"): Promise<AudioSettingsSnapshot>;
  audioCommand(id: "audio.channelPercent", args: { key: AudioChannel; percent: number }): Promise<AudioSettingsSnapshot>;
  audioCommand(id: "audio.channelMuted", args: { key: AudioChannel; muted: boolean }): Promise<AudioSettingsSnapshot>;
  audioCommand(id: "audio.breakSlideTailCheerMuted", args: { value: boolean }): Promise<AudioSettingsSnapshot>;
  audioCommand(id: "audio.restoreSettings", args: { settings: AudioSettingsSnapshot["settings"] }): Promise<AudioSettingsSnapshot>;
  setLatency(settings: Partial<LatencySettings>): Promise<PreviewState>;
  detectLatency(kind: "bpm"): Promise<BpmDetectionResult>;
  detectLatency(kind: "offset", parameters: { bpm: number; offsetSeconds: number }): Promise<{ offsetSeconds: number }>;
  getState(): Promise<PreviewState>;
  setPerformance(changes: Partial<Omit<PerformanceSettings, "canvasFrameRateMode">> & { canvasFrameRateMode?: FrameRateMode }): Promise<PerformanceSettings>;
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
