import { Bucket } from '@google-cloud/storage';

/**
 * Upload a base64 image to Firebase Storage
 * 
 * @param bucket - Firebase Storage bucket
 * @param filePath - Path within the bucket (e.g., 'reviews/worker123/trial_1_v1.png')
 * @param base64Data - Base64 encoded image data
 * @returns Public URL of the uploaded file
 */
export async function uploadImageToStorage(
  bucket: Bucket,
  filePath: string,
  base64Data: string
): Promise<string> {
  // Remove data URL prefix if present
  const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Image, 'base64');

  const file = bucket.file(filePath);
  
  await file.save(buffer, {
    metadata: {
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000', // Cache for 1 year
      metadata: {
        generatedAt: new Date().toISOString(),
      },
    },
  });

  // Make file publicly readable
  await file.makePublic();

  // Return public URL
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

/**
 * Delete a file from Firebase Storage
 * Useful for cleanup or regeneration
 */
export async function deleteImageFromStorage(
  bucket: Bucket,
  filePath: string
): Promise<void> {
  const file = bucket.file(filePath);
  await file.delete();
  console.log(`🗑️ Deleted ${filePath} from storage`);
}
