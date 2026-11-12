// Types for docxflow.js, which is shared word for word with the browser app.

export interface FlowText {
  str: string; x: number; w: number; base: number; size: number;
  font: string; kind: string; bold: boolean; italic: boolean; color: string; link: string | null;
}
export interface FlowPage {
  w: number; h: number;
  texts: FlowText[];
  rects: { x: number; y: number; w: number; h: number; fill: string | null; stroke: string | null; lw: number; round: boolean }[];
  lines: { x1: number; y1: number; x2: number; y2: number; color: string; lw: number }[];
  shapes: { x: number; y: number; w: number; h: number }[];
  images: { x: number; y: number; w: number; h: number; id: string; faint?: boolean }[];
}
export type FlowMedia = Record<string, { bytes: Uint8Array; ext: 'png' | 'jpeg' }>;
export type Region = { x: number; y: number; w: number; h: number };

export function buildEditableDocx(
  pages: FlowPage[],
  media: FlowMedia,
  renderRegion: (pageIndex: number, region: Region) => Promise<Uint8Array>,
  options?: { title?: string },
): Promise<Record<string, string | Uint8Array>>;

export function buildEditablePptx(
  pages: FlowPage[],
  media: FlowMedia,
  renderRegion: (pageIndex: number, region: Region) => Promise<Uint8Array>,
  options?: { title?: string },
): Promise<Record<string, string | Uint8Array>>;
