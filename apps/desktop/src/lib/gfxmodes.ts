/* The Graphics tab's views (spec 14.5): memory as characters, sprites, bitmaps, screens or a font per row (lib/gfxview).
 * The mode switch over the tab lists them. */
import type { ViewMode } from '../components/ViewModes';
import type { GfxKind } from './gfxview';

export const GFX_MODES: ViewMode<GfxKind>[] = [
  { key: 'chars', label: 'Characters', icon: 'grid', sub: '8×8', title: 'Memory as characters: 8 bytes, 8 × 8 pixels each' },
  { key: 'sprites', label: 'Sprites', icon: 'sprite', sub: '24×21', title: 'Memory as sprites: 64 bytes, 24 × 21 pixels each' },
  { key: 'bitmap', label: 'Bitmaps', icon: 'image', sub: '320×200', title: 'Memory as bitmaps: 8000 bytes, 320 × 200 pixels each' },
  { key: 'screens', label: 'Screens', icon: 'screen', sub: '40×25', title: 'Memory as screens: 1000 screen codes, 40 × 25 characters each' },
  { key: 'fontrows', label: 'Font per row', icon: 'rows', title: 'A picture whose character rows each have their own font' },
];

/** an image as PNG bytes, through a canvas */
export async function pngOf(img: { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }): Promise<Uint8Array> {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d')!.putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  const blob = await new Promise<Blob | null>(done => cv.toBlob(done, 'image/png'));
  if (!blob) throw new Error('the image could not be made');
  return new Uint8Array(await blob.arrayBuffer());
}
