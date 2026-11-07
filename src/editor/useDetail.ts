import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PageRegion } from '../pdf/render';
import type { PageItem, Source } from '../workspace/types';

/** Longest side of a whole-page rendering in the editor; beyond it, the part in view is rendered on its own. */
export const FULL_PAGE_PIXELS = 4096;
/** Largest detail rendering, in pixels, to keep memory modest on big screens. */
const MAX_DETAIL_PIXELS = 12_000_000;

/** A sharp rendering of part of the page, placed as fractions of the unrotated page. */
export interface Detail {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * When the page is shown bigger than a whole-page rendering can be sharp for, renders the part in
 * view (with some room around it) at full resolution, once scrolling and zooming pause.
 * `visible` gives that part in points of the unrotated page, with `margin` added on each side.
 */
export function useDetail(
  source: Source,
  page: PageItem,
  /** The unrotated page's size in points. */
  pageSize: { width: number; height: number },
  /** Device pixels per point the page is shown at. */
  deviceScale: number,
  needed: boolean,
  visible: (margin: number) => PageRegion | null,
  scroller: RefObject<HTMLElement | null>,
): Detail | null {
  const [detail, setDetail] = useState<Detail | null>(null);
  const latest = useRef({ visible, deviceScale });
  latest.current = { visible, deviceScale };
  const pdf = source.kind === 'pdf' ? source : null;

  useEffect(() => {
    if (!needed || !pdf) {
      setDetail(null);
      return;
    }
    let timer = 0;
    let request = 0;
    const render = () => {
      const { visible, deviceScale: scale } = latest.current;
      let region = visible(0.25);
      // on very big screens, render just what is in view
      if (region && region.width * region.height * scale * scale > MAX_DETAIL_PIXELS) region = visible(0);
      if (!region || region.width * region.height * scale * scale > MAX_DETAIL_PIXELS) return;
      const id = ++request;
      void import('../pdf/render')
        .then(({ renderPdfRegion }) => renderPdfRegion(pdf.bytes, page.pageIndex, scale, region))
        .then(
          (url) => {
            if (id !== request) return URL.revokeObjectURL(url);
            setDetail({
              url,
              x: region.x / pageSize.width,
              y: region.y / pageSize.height,
              width: region.width / pageSize.width,
              height: region.height / pageSize.height,
            });
          },
          (error) => console.error('Could not render page detail', error),
        );
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(render, 200);
    };
    schedule();
    const element = scroller.current;
    element?.addEventListener('scroll', schedule, { passive: true });
    return () => {
      request++;
      window.clearTimeout(timer);
      element?.removeEventListener('scroll', schedule);
    };
  }, [needed, pdf, page.pageIndex, deviceScale, pageSize.width, pageSize.height, scroller]);

  // each rendering is released once the next one shows, and the last with the editor
  const url = detail?.url;
  useEffect(() => (url ? () => URL.revokeObjectURL(url) : undefined), [url]);

  return detail;
}
