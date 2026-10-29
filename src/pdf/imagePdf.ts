import type { Rotation } from '../workspace/types';
import type { SourceImage } from './images';
import { uprightImageMatrix, type ImagePageLayout } from './layout';

// A minimal PDF writer for documents made only of JPEG photos, the "160 MB of pictures"
// case. JPEG data can go into a PDF unchanged (DCTDecode), so each photo is added to the
// output Blob by reference: nothing is decoded or copied through JavaScript, and memory use
// stays flat however large the files are. Anything fancier goes through pdf-lib instead.

export interface JpegPage {
  image: SourceImage;
  layout: ImagePageLayout;
  rotation: Rotation;
}

export function canWriteDirectly(image: SourceImage): boolean {
  return image.format === 'jpg' && [1, 3, 4].includes(image.components);
}

const COLOR_SPACES: Record<number, string> = {
  1: '/ColorSpace /DeviceGray',
  3: '/ColorSpace /DeviceRGB',
  // Adobe writes CMYK JPEGs inverted; pdf-lib makes the same assumption
  4: '/ColorSpace /DeviceCMYK /Decode [1 0 1 0 1 0 1 0]',
};

/** Numbers as PDF wants them: plain decimals, never exponent notation. */
function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function writeJpegPdf(pages: JpegPage[], producer: string): Blob {
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let position = 0;

  // strings written here are plain ASCII, so their length is their size in bytes
  const write = (part: string | Blob | Uint8Array) => {
    parts.push(part as BlobPart);
    position += typeof part === 'string' ? part.length : part instanceof Blob ? part.size : part.byteLength;
  };
  const object = (id: number, body: string) => {
    offsets[id] = position;
    write(`${id} 0 obj\n${body}\nendobj\n`);
  };

  write('%PDF-1.7\n');
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment

  // 1 catalog, 2 page tree, 3 info, then three objects per page: page, contents, image
  const pageId = (index: number) => 4 + index * 3;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`);
  object(3, `<< /Producer (${producer}) /Creator (${producer}) >>`);

  pages.forEach(({ image, layout, rotation }, index) => {
    const id = pageId(index);
    const quarter = image.turn % 180 !== 0;
    const storedWidth = quarter ? image.height : image.width;
    const storedHeight = quarter ? image.width : image.height;

    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(layout.pageWidth)} ${num(layout.pageHeight)}] /Rotate ${rotation}` +
        ` /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );

    const content = `q ${uprightImageMatrix(image.turn, layout).map(num).join(' ')} cm /Im0 Do Q`;
    object(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

    offsets[id + 2] = position;
    write(
      `${id + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${storedWidth} /Height ${storedHeight} ` +
        `${COLOR_SPACES[image.components]} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.blob.size} >>\nstream\n`,
    );
    write(image.blob);
    write('\nendstream\nendobj\n');
  });

  const count = 4 + pages.length * 3;
  const xref = position;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}
