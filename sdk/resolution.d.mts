export type MiaCodeResolution = Readonly<{ width: number; height: number }>;
export const DEFAULT_RESOLUTION: MiaCodeResolution;
export const MAX_RENDER_DIMENSION: number;
export function previewResolution(value?: MiaCodeResolution): MiaCodeResolution;
export function resolutionFromSearch(search: string): MiaCodeResolution;
export function previewLaunchUrl(resolution?: MiaCodeResolution): string;
