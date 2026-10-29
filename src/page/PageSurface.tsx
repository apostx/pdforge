import { useEffect, useMemo, useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react';
import { cssFamily, fontKey, layoutText, loadFont, type LoadedFont, type TextLayout } from '../pdf/fonts';
import type { PageGeometry } from '../workspace/geometry';
import type { Overlay, TextOverlay } from '../workspace/types';

/** Lays out a text overlay once its font has loaded (null until then). */
export function useTextLayout(overlay: TextOverlay | null): TextLayout | null {
  const key = overlay ? fontKey(overlay) : null;
  const [loaded, setLoaded] = useState<{ key: string; font: LoadedFont } | null>(null);

  useEffect(() => {
    if (!overlay || !key) return;
    let cancelled = false;
    loadFont(overlay).then(
      (font) => !cancelled && setLoaded({ key, font }),
      (error) => console.error(error),
    );
    return () => {
      cancelled = true;
    };
    // the key covers everything loadFont reads from the overlay
  }, [key]);

  const font = loaded?.key === key ? loaded.font.font : null;
  const text = overlay?.text;
  const size = overlay?.size;
  return useMemo(
    () => (font && text !== undefined && size !== undefined ? layoutText(font, text, size) : null),
    [font, text, size],
  );
}

/** Size of an overlay in points, or null while a text overlay's font is loading. */
export function overlaySize(overlay: Overlay, layout: TextLayout | null) {
  if (overlay.kind === 'text') return layout && { width: layout.width, height: layout.height };
  return { width: overlay.width, height: overlay.height };
}

type OverlayViewProps = {
  overlay: Overlay;
  geometry: PageGeometry;
  ref?: Ref<HTMLDivElement>;
} & HTMLAttributes<HTMLDivElement>;

export function OverlayView({ overlay, geometry, className, style, children, ...rest }: OverlayViewProps) {
  const layout = useTextLayout(overlay.kind === 'text' ? overlay : null);
  const size = overlaySize(overlay, layout);
  if (!size) return null;

  const position: CSSProperties = {
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    width: `${(size.width / geometry.width) * 100}%`,
    height: `${(size.height / geometry.height) * 100}%`,
    transform: overlay.rotation ? `rotate(${-overlay.rotation}deg)` : undefined,
    background: overlay.kind === 'rect' ? overlay.color : undefined,
    ...style,
  };

  return (
    <div className={['overlay', className].filter(Boolean).join(' ')} style={position} {...rest}>
      {overlay.kind === 'image' && <img src={overlay.url} alt="" draggable={false} />}
      {overlay.kind === 'text' && layout && (
        // SVG puts each baseline exactly where the PDF will have it
        <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
          <text
            fill={overlay.color}
            fontFamily={cssFamily[overlay.family]}
            fontWeight={overlay.bold ? 700 : 400}
            fontSize={overlay.size}
            className="overlay__text"
          >
            {layout.lines.map((line, index) => (
              <tspan key={index} x={0} y={layout.ascent + index * layout.lineHeight}>
                {line}
              </tspan>
            ))}
          </text>
        </svg>
      )}
      {children}
    </div>
  );
}

interface PageSurfaceProps {
  geometry: PageGeometry;
  /** The rendered PDF page, or for image pages the image itself. */
  backgroundUrl?: string;
  overlays: Overlay[];
  /** Pixel size of the unrotated page. Without it the page is fitted into its (square) parent. */
  size?: { width: number; height: number };
  className?: string;
  overlayProps?: (overlay: Overlay) => Omit<OverlayViewProps, 'overlay' | 'geometry'>;
}

/** A page as it will come out: background plus overlays, rotated for display. */
export function PageSurface({ geometry, backgroundUrl, overlays, size, className, overlayProps }: PageSurfaceProps) {
  const { width, height, rotation, imageRect } = geometry;
  const box: CSSProperties = size
    ? { width: size.width, height: size.height }
    : width >= height
      ? { width: '100%', height: `${(height / width) * 100}%` }
      : { width: `${(width / height) * 100}%`, height: '100%' };

  return (
    <div
      className={['page-surface doc-surface', className].filter(Boolean).join(' ')}
      style={{ ...box, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
    >
      {backgroundUrl && (
        <img
          className="page-surface__background"
          src={backgroundUrl}
          alt=""
          draggable={false}
          style={
            imageRect && {
              left: `${imageRect.x * 100}%`,
              top: `${imageRect.y * 100}%`,
              width: `${imageRect.width * 100}%`,
              height: `${imageRect.height * 100}%`,
            }
          }
        />
      )}
      {overlays.map((overlay) => (
        <OverlayView key={overlay.id} overlay={overlay} geometry={geometry} {...overlayProps?.(overlay)} />
      ))}
    </div>
  );
}
