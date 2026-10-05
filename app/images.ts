import {
  createHarnessImageId,
  harnessImageMimeTypeFromDataUrl,
  isHarnessImageDataUrl,
  type ConnectorPhoto,
  type HarnessImage,
  type HarnessProject,
} from "./model.ts";

const CONNECTOR_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const HARNESS_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const CONNECTOR_MAX_SOURCE_BYTES = 8_000_000;
const CONNECTOR_MAX_DIMENSION = 720;
const HARNESS_MAX_SOURCE_BYTES = 25_000_000;
export const HARNESS_IMAGE_MAX_DIMENSION = 1_920;
const HARNESS_MAX_DATA_URL_LENGTH = 16_000_000;

interface DecodedRaster {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

interface PrepareRasterOptions {
  allowedTypes: ReadonlySet<string>;
  formatError: string;
  sizeError: string;
  maxSourceBytes: number;
  maxDimension: number;
  quality: number;
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be decoded."));
    image.src = dataUrl;
  });
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function decodeRaster(file: File): Promise<DecodedRaster> {
  if (typeof createImageBitmap === "function") {
    try {
      // Apply EXIF orientation before canvas re-encoding so every renderer sees
      // the same oriented pixels and no source metadata remains embedded.
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Older browsers fall back to their normal oriented HTML image decode.
    }
  }
  const image = await loadImage(await readDataUrl(file));
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    dispose: () => undefined,
  };
}

export function scaledImageDimensions(
  width: number,
  height: number,
  maxDimension: number,
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(maxDimension) ||
    maxDimension <= 0
  ) {
    throw new Error("The selected image has invalid dimensions.");
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isAcceptedHarnessImageType(type: string) {
  return HARNESS_IMAGE_TYPES.has(type);
}

export function approximateDataUrlBytes(dataUrl: string) {
  const payload = dataUrl.split(",", 2)[1]?.replace(/\s/g, "") ?? "";
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function formatMegabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function prepareRasterImage(file: File, options: PrepareRasterOptions) {
  if (!options.allowedTypes.has(file.type)) throw new Error(options.formatError);
  if (file.size > options.maxSourceBytes) throw new Error(options.sizeError);

  const decoded = await decodeRaster(file);
  try {
    const { width, height } = scaledImageDimensions(
      decoded.width,
      decoded.height,
      options.maxDimension,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", options.quality);
    if (!harnessImageMimeTypeFromDataUrl(dataUrl)) {
      throw new Error("The normalized image could not be encoded.");
    }
    return { dataUrl, mimeType: "image/jpeg" as const, width, height };
  } finally {
    decoded.dispose();
  }
}

export async function prepareConnectorPhoto(
  file: File,
  alt: string,
): Promise<ConnectorPhoto> {
  const image = await prepareRasterImage(file, {
    allowedTypes: CONNECTOR_IMAGE_TYPES,
    formatError: "Connector photos must be JPEG, PNG, or WebP images.",
    sizeError: "Connector photos must be smaller than 8 MB.",
    maxSourceBytes: CONNECTOR_MAX_SOURCE_BYTES,
    maxDimension: CONNECTOR_MAX_DIMENSION,
    quality: 0.84,
  });
  return {
    ...image,
    fileName: file.name.slice(0, 240),
    alt: alt.trim().slice(0, 500) || "Connector photo",
  };
}

export async function prepareHarnessImage(file: File): Promise<HarnessImage> {
  const image = await prepareRasterImage(file, {
    allowedTypes: HARNESS_IMAGE_TYPES,
    formatError: "Harness images must be JPEG or PNG files.",
    sizeError: "Harness images must be smaller than 25 MB before normalization.",
    maxSourceBytes: HARNESS_MAX_SOURCE_BYTES,
    maxDimension: HARNESS_IMAGE_MAX_DIMENSION,
    quality: 0.85,
  });
  if (image.dataUrl.length > HARNESS_MAX_DATA_URL_LENGTH) {
    throw new Error(
      `The normalized image is still too large (${formatMegabytes(
        approximateDataUrlBytes(image.dataUrl),
      )}); choose a less complex or smaller image.`,
    );
  }
  return {
    id: createHarnessImageId(),
    ...image,
    originalFilename: file.name.slice(0, 240),
  };
}

export function validateHarnessImages(project: HarnessProject) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const images = Array.isArray(project.harnessImages) ? project.harnessImages : [];
  let totalBytes = 0;

  for (const [index, image] of images.entries()) {
    const label = image?.title?.trim() || image?.originalFilename || `image ${index + 1}`;
    if (!image?.id) {
      errors.push(`Harness image ${index + 1} is missing its internal ID.`);
    } else if (ids.has(image.id)) {
      errors.push(`Harness image "${label}" duplicates internal ID ${image.id}.`);
    } else {
      ids.add(image.id);
    }
    if (!image?.dataUrl) {
      errors.push(`Harness image "${label}" has no embedded image data.`);
      continue;
    }
    if (!isHarnessImageDataUrl(image.dataUrl)) {
      errors.push(`Harness image "${label}" has invalid or unsupported embedded data.`);
      continue;
    }
    const detectedType = harnessImageMimeTypeFromDataUrl(image.dataUrl);
    if (image.mimeType !== detectedType) {
      errors.push(`Harness image "${label}" has inconsistent MIME metadata.`);
    }
    if (
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.height) ||
      image.width <= 0 ||
      image.height <= 0
    ) {
      errors.push(`Harness image "${label}" has invalid dimensions.`);
    }
    totalBytes += approximateDataUrlBytes(image.dataUrl);
  }

  if (totalBytes > 25_000_000) {
    warnings.push(
      `Harness images use approximately ${formatMegabytes(totalBytes)}; autosave and report generation may be slower.`,
    );
  }
  return { errors, warnings };
}
