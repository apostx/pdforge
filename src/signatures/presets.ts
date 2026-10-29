import { centredAnchor, displayToPage, type PageGeometry } from '../workspace/geometry';
import type { ImageOverlay, PageItem } from '../workspace/types';
import type { Signature } from './SignatureProvider';

export type PresetPages = 'last' | 'first' | 'all' | 'selected';
export type PresetPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** Where a signature goes, as the page is seen on screen (so "bottom right" survives page rotation). */
export interface PlacementPreset {
  id: string;
  /** Empty for built-in presets, which are named by the UI in the current language. */
  name: string;
  pages: PresetPages;
  position: PresetPosition;
  widthMm: number;
  marginMm: number;
}

export const builtInPresets: PlacementPreset[] = [
  { id: 'builtin-last-bottom-right', name: '', pages: 'last', position: 'bottom-right', widthMm: 50, marginMm: 20 },
  { id: 'builtin-last-bottom-left', name: '', pages: 'last', position: 'bottom-left', widthMm: 50, marginMm: 20 },
  { id: 'builtin-all-initials', name: '', pages: 'all', position: 'bottom-right', widthMm: 25, marginMm: 10 },
];

export const presetPositions: PresetPosition[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

const POINTS_PER_MM = 72 / 25.4;

export function targetPages(pages: PageItem[], selected: ReadonlySet<string>, which: PresetPages): PageItem[] {
  switch (which) {
    case 'first':
      return pages.slice(0, 1);
    case 'last':
      return pages.slice(-1);
    case 'all':
      return pages;
    case 'selected':
      return pages.filter((page) => selected.has(page.id));
  }
}

/** Signature size in points: the preset width, shrunk if needed to fit the page as shown. */
function signatureSize(signature: Signature, shownWidth: number, shownHeight: number, widthMm: number, margin: number) {
  const aspect = signature.image.height / signature.image.width;
  let width = widthMm * POINTS_PER_MM;
  width = Math.min(width, shownWidth - 2 * margin, (shownHeight / 3) / aspect);
  width = Math.max(width, 10);
  return { width, height: width * aspect };
}

function quarterTurn(geometry: PageGeometry) {
  return geometry.rotation % 180 !== 0;
}

export function placeSignature(
  signature: Signature,
  geometry: PageGeometry,
  preset: Pick<PlacementPreset, 'position' | 'widthMm' | 'marginMm'>,
  url: string,
): ImageOverlay {
  const shownWidth = quarterTurn(geometry) ? geometry.height : geometry.width;
  const shownHeight = quarterTurn(geometry) ? geometry.width : geometry.height;
  const margin = preset.marginMm * POINTS_PER_MM;
  const { width, height } = signatureSize(signature, shownWidth, shownHeight, preset.widthMm, margin);

  const [vertical, horizontal] = preset.position.split('-');
  const left = horizontal === 'left' ? margin : horizontal === 'right' ? shownWidth - margin - width : (shownWidth - width) / 2;
  const top = vertical === 'top' ? margin : shownHeight - margin - height;
  const anchor = displayToPage(geometry, { x: left, y: top });

  return {
    id: crypto.randomUUID(),
    kind: 'image',
    x: anchor.x / geometry.width,
    y: anchor.y / geometry.height,
    rotation: geometry.rotation,
    image: signature.image,
    url,
    width,
    height,
  };
}

/** A signature dropped in the middle of the page (from the editor). */
export function centredSignature(signature: Signature, geometry: PageGeometry, url: string): ImageOverlay {
  const shownWidth = quarterTurn(geometry) ? geometry.height : geometry.width;
  const shownHeight = quarterTurn(geometry) ? geometry.width : geometry.height;
  const { width, height } = signatureSize(signature, shownWidth, shownHeight, 50, 0);
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    ...centredAnchor(geometry, width, height, geometry.rotation),
    rotation: geometry.rotation,
    image: signature.image,
    url,
    width,
    height,
  };
}
