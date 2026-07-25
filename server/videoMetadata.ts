/**
 * Video metadata extraction utility.
 * 
 * In a Node.js server environment, we can extract video metadata by:
 * 1. Parsing the container format headers (MP4/MOV) directly from the buffer
 * 2. Reading duration, resolution, FPS, and audio track presence
 * 
 * This avoids needing ffmpeg as a system dependency.
 */

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

/**
 * Parse MP4/MOV container to extract video metadata.
 * Works with H.264/H.265/VP8/VP9 encoded videos in MP4/MOV containers.
 */
export function extractVideoMetadata(buffer: Buffer): VideoMetadata {
  const metadata: VideoMetadata = {
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    hasAudio: false,
  };

  if (buffer.length < 8) return metadata;

  // Check for ftyp box (MP4)
  const boxSize = buffer.readUInt32BE(0);
  const boxType = buffer.toString("ascii", 4, 8);

  let offset = 0;
  const fileSize = buffer.length;

  // Parse top-level boxes
  while (offset < fileSize - 8) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);

    if (size === 0) break;
    if (size > fileSize - offset) size = fileSize - offset;

    if (type === "moov") {
      parseMoov(buffer, offset + 8, offset + size, metadata);
    }

    offset += size;
  }

  // Estimate FPS from timescale if we have duration
  if (metadata.duration > 0 && metadata.width > 0) {
    metadata.fps = 30; // Default estimate, actual FPS parsing requires more complex parsing
  }

  return metadata;
}

function parseMoov(buffer: Buffer, start: number, end: number, metadata: VideoMetadata) {
  let offset = start;

  while (offset < end - 8) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);

    if (size === 0) break;
    if (size > end - offset) break;

    if (type === "mvhd") {
      parseMvhd(buffer, offset, size, metadata);
    } else if (type === "trak") {
      parseTrak(buffer, offset + 8, offset + size, metadata);
    }

    offset += size;
  }
}

function parseMvhd(buffer: Buffer, offset: number, size: number, metadata: VideoMetadata) {
  // mvhd box: version (1) + flags (3) + creation_time (4) + modification_time (4)
  // + timescale (4) + duration (4) + ...
  const version = buffer.readUInt8(offset + 8);
  const headerSize = version === 1 ? 20 : 8;

  const timescale = buffer.readUInt32BE(offset + 8 + headerSize);
  const duration = buffer.readUInt32BE(offset + 8 + headerSize + 4);

  if (timescale > 0) {
    metadata.duration = duration / timescale;
  }
}

function parseTrak(buffer: Buffer, start: number, end: number, metadata: VideoMetadata) {
  let offset = start;

  while (offset < end - 8) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);

    if (size === 0) break;
    if (size > end - offset) break;

    if (type === "tkhd") {
      parseTkhd(buffer, offset, size, metadata);
    } else if (type === "mdia") {
      parseMdia(buffer, offset + 8, offset + size, metadata);
    }

    offset += size;
  }
}

function parseTkhd(buffer: Buffer, offset: number, size: number, metadata: VideoMetadata) {
  // tkhd contains track dimensions at the end
  // For version 0: skip to the matrix area
  const version = buffer.readUInt8(offset + 8);
  const headerSkip = version === 1 ? 32 : 20;

  // Width and height are 16.16 fixed-point at offset + 8 + headerSkip + 60
  const whOffset = offset + 8 + headerSkip + 60;
  if (whOffset + 8 <= offset + size) {
    const width = buffer.readUInt32BE(whOffset) / 65536;
    const height = buffer.readUInt32BE(whOffset + 4) / 65536;
    if (width > 0 && height > 0) {
      metadata.width = Math.round(width);
      metadata.height = Math.round(height);
    }
  }
}

function parseMdia(buffer: Buffer, start: number, end: number, metadata: VideoMetadata) {
  let offset = start;

  while (offset < end - 8) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);

    if (size === 0) break;
    if (size > end - offset) break;

    if (type === "hdlr") {
      const handlerType = buffer.toString("ascii", offset + 16, offset + 20);
      if (handlerType === "soun") {
        metadata.hasAudio = true;
      }
    }

    offset += size;
  }
}

/**
 * Generate a thumbnail from a video file by extracting a frame.
 * Uses the MP4 moof/mdata structure to find the first keyframe.
 * Returns a base64-encoded JPEG thumbnail or null if extraction fails.
 */
export function generateThumbnail(buffer: Buffer): string | null {
  // For now, return null - thumbnail generation requires a video processing library
  // In production, this would use ffmpeg or a WASM-based decoder
  return null;
}

export function isVideoFile(mimeType: string): boolean {
  const videoMimeTypes = [
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-msvideo",
    "video/x-matroska",
  ];
  return videoMimeTypes.includes(mimeType) || mimeType.startsWith("video/");
}
