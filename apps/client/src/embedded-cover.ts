const MAX_COVER_BYTES = 10 * 1024 * 1024;
function imageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const text = (start:number,end:number) => String.fromCharCode(...bytes.subarray(start,end));
  if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(text(0,6))) return 'image/gif';
  if (bytes.length >= 12 && text(0,4) === 'RIFF' && text(8,12) === 'WEBP') return 'image/webp';
  return null; // Do not render embedded SVG/HTML or trust the tag's MIME label.
}

/** Parse the actual local song bytes. Missing/broken tags must never break playback. */
export async function extractEmbeddedCover(audio: Uint8Array, mimeType?: string): Promise<Blob | null> {
  try {
    const { parseBuffer, selectCover } = await import('music-metadata');
    const metadata = await parseBuffer(audio, { mimeType, size: audio.byteLength }, {
      duration:false, skipCovers:false, maxMemoryAllocation:16*1024*1024, maxMetadataEntries:4096,
    });
    const pictures = metadata.common.picture?.filter(picture => picture.data.byteLength > 0 && picture.data.byteLength <= MAX_COVER_BYTES && imageType(picture.data));
    const picture = selectCover(pictures);
    if (!picture) return null;
    const type = imageType(picture.data); if (!type) return null;
    // Copy only the image, not the entire audio buffer or a parser-owned view.
    return new Blob([new Uint8Array(picture.data)], { type });
  } catch { return null; }
}
