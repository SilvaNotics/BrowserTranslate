import type { Region } from './types';
export function cropBounds(r: Region, imageWidth: number, imageHeight: number) {
  if (
    ![
      r.x,
      r.y,
      r.width,
      r.height,
      r.viewportWidth,
      r.viewportHeight,
      imageWidth,
      imageHeight,
    ].every(Number.isFinite) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width < 8 ||
    r.height < 8 ||
    r.viewportWidth <= 0 ||
    r.viewportHeight <= 0 ||
    r.x + r.width > r.viewportWidth + 1 ||
    r.y + r.height > r.viewportHeight + 1
  )
    throw new Error('选区无效，请重新框选至少 8 × 8 像素的区域。');
  const sx = imageWidth / r.viewportWidth,
    sy = imageHeight / r.viewportHeight;
  const x = Math.round(r.x * sx),
    y = Math.round(r.y * sy);
  return {
    x,
    y,
    width: Math.min(Math.round(r.width * sx), imageWidth - x),
    height: Math.min(Math.round(r.height * sy), imageHeight - y),
  };
}
export async function cropImage(dataUrl: string, region: Region): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const bounds = cropBounds(region, bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(bounds.width, bounds.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('截图裁剪不可用');
    ctx.drawImage(
      bitmap,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );
    const output = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await output.arrayBuffer());
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192)
      binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return 'data:image/png;base64,' + btoa(binary);
  } finally {
    bitmap.close();
  }
}
