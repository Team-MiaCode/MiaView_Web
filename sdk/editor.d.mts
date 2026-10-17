import type { ChartInput, DocumentSnapshot, PreviewEvents, PreviewOptions, PreviewState } from "./index.mjs";

export type EditorOptions = Pick<PreviewOptions, "theme" | "resolution" | "pvTimeoutMs" | "diagnostics" | "rendererUrl" | "timeoutMs">;
export interface MiaCodeEditor {
  readonly ready: Promise<MiaCodeEditor>;
  load(chart: ChartInput): Promise<DocumentSnapshot>;
  /** Uses the workbench command identifiers documented in WEB_EDITOR_COMMANDS_ZH.md. */
  command(id: string, args?: Record<string, unknown>): Promise<void>;
  getDocument(): Promise<DocumentSnapshot>;
  getDocumentSaveText(section?: number): Promise<{ sourceText: string; revision: number }>;
  getState(): Promise<PreviewState>;
  on<K extends keyof PreviewEvents>(type: K, listener: (event: PreviewEvents[K]) => void): () => void;
  destroy(): void;
}
export function createEditor(container: HTMLElement, options?: EditorOptions): MiaCodeEditor;
