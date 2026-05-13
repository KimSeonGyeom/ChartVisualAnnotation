import { Bucket } from '@google-cloud/storage';

/**
 * Upload a base64-encoded image to Firebase Storage and return its public URL.
 */
export async function uploadImageToStorage(
  bucket: Bucket,
  filePath: string,
  base64Data: string
): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: { contentType: 'image/png' },
  });

  await file.makePublic();

  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}
