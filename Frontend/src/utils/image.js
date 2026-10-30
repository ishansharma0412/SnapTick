// Downscale large photos in the browser before upload.
// RetinaFace never looks at more than ~1980px on the long side, so anything
// bigger only costs upload time (and can hit the 8 MB server limit).
export async function downscaleImage(file, maxDim = 1980, quality = 0.92) {
  if (!file || !file.type?.startsWith("image/")) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 2 * 1024 * 1024) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob || blob.size >= file.size) return file;

  const name = file.name ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : "photo.jpg";
  return new File([blob], name, { type: "image/jpeg" });
}
