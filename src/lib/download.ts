export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // revoking right away can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
