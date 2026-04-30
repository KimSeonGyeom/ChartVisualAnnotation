import { GoogleGenAI } from '@google/genai';
import { buildPrompt } from './prompts';

interface GenerationInput {
  chartIndex: number;
  imageUrl: string;
  caption: string;
  userDrawingBase64: string; // Supports data URL/base64 or Storage URL
  userIntent: string;
  prolificId: string;
  apiKey: string;
}

interface GenerationOutput {
  image1Base64: string;
  image2Base64: string;
}

// Real-time experiment: short bounded retries without long stalls.
const IMAGE_FETCH_RETRY_DELAYS_MS = [0, 500, 1000];
const IMAGE_FETCH_TIMEOUT_MS = 2000;
const GEMINI_RETRY_DELAYS_MS = [0, 500, 1000];
const GEMINI_MAX_ATTEMPTS = GEMINI_RETRY_DELAYS_MS.length;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getErrorStatus(error: any): number | undefined {
  return error?.status ?? error?.code ?? error?.response?.status;
}

function isRetriableGeminiError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const status = getErrorStatus(error as any);

  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (message.includes('timeout')) return true;
  if (message.includes('network')) return true;
  if (message.includes('unavailable')) return true;
  if (message.includes('rate limit')) return true;

  // We see this intermittently under load; short retries often recover.
  if (message.includes('no image data in gemini response')) return true;

  return false;
}

/**
 * Generate two versions of annotated charts using Gemini:
 * 1. Based on original chart only (no worker drawing input)
 * 2. Based on original chart + worker's pen drawing overlay
 */
export async function generateAnnotatedCharts(
  input: GenerationInput
): Promise<GenerationOutput> {
  if (!input.apiKey) {
    throw new Error('Gemini API key not provided');
  }

  const ai = new GoogleGenAI({ apiKey: input.apiKey });

  console.log(`🤖 Generating 2 annotated charts for worker ${input.prolificId}, chart ${input.chartIndex}`);

  const prompt = buildPrompt(input);

  try {
    // Generate both versions in parallel
    const [image1, image2] = await Promise.all([
      generateSingleChart(ai, prompt, input, false),  // Without worker drawing
      generateSingleChart(ai, prompt, input, true),   // With worker drawing
    ]);

    console.log(`✅ Successfully generated 2 chart versions for worker ${input.prolificId}`);
    
    return {
      image1Base64: image1,
      image2Base64: image2,
    };
  } catch (error: any) {
    console.error(`❌ Gemini generation failed for worker ${input.prolificId}:`, error);
    throw new Error(`Gemini generation failed: ${error.message}`);
  }
}

/**
 * Generate a single annotated chart
 * @param includeWorkerDrawing - If true, includes worker's drawing as additional input
 */
async function generateSingleChart(
  ai: GoogleGenAI,
  prompt: string,
  input: GenerationInput,
  includeWorkerDrawing: boolean
): Promise<string> {
  if (includeWorkerDrawing && !input.userDrawingBase64) {
    throw new Error(
      `Human drawing image is required for drawing-guided generation ` +
      `(worker=${input.prolificId}, chart=${input.chartIndex})`
    );
  }

  // Determine which image to send to Gemini
  let finalImageBase64: string;
  
  if (includeWorkerDrawing && input.userDrawingBase64) {
    // Use worker drawing image from either Storage URL or legacy base64/data URL
    if (input.userDrawingBase64.startsWith('http')) {
      finalImageBase64 = await fetchImageAsBase64(input.userDrawingBase64);
    } else {
      finalImageBase64 = input.userDrawingBase64.includes(',')
        ? input.userDrawingBase64.split(',')[1]
        : input.userDrawingBase64;
    }
  } else {
    // Use original chart only
    const originalChartBase64 = await fetchImageAsBase64(input.imageUrl);
    finalImageBase64 = originalChartBase64;
  }

  const contents: any[] = [
    { text: prompt },
    { 
      inlineData: {
        data: finalImageBase64,
        mimeType: 'image/jpeg',
      }
    }
  ];

  console.log('🧪 Gemini request summary:', {
    worker: input.prolificId,
    chartIndex: input.chartIndex,
    includeWorkerDrawing,
    promptLength: prompt.length,
    inputImageChars: finalImageBase64.length,
    hasUserDrawing: Boolean(input.userDrawingBase64),
  });

  let lastError: unknown = null;

  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt++) {
    const delayMs = GEMINI_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      // Call Gemini with new SDK for image editing
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: contents,
        config: {
          responseModalities: ['IMAGE'],
        },
      });

      const firstCandidate = response?.candidates?.[0];
      const partKinds = (firstCandidate?.content?.parts || []).map((part: any) => {
        if (part.inlineData?.data) return 'image';
        if (part.text) return 'text';
        return 'other';
      });
      console.log('🧪 Gemini response summary:', {
        worker: input.prolificId,
        chartIndex: input.chartIndex,
        includeWorkerDrawing,
        attempt: attempt + 1,
        candidates: response?.candidates?.length || 0,
        partKinds,
        finishReason: (firstCandidate as any)?.finishReason || null,
        promptFeedback: (response as any)?.promptFeedback || null,
      });

      // Extract generated image from all candidates (not only first one)
      if (response.candidates) {
        for (const candidate of response.candidates) {
          const parts = candidate?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              return part.inlineData.data;
            }
          }
        }
      }

      // Log the full response structure for debugging
      console.error('❌ Gemini response structure (no image part):', JSON.stringify(response, null, 2));
      throw new Error('No image data in Gemini response');
    } catch (error: unknown) {
      lastError = error;
      const retriable = isRetriableGeminiError(error);
      const hasNextAttempt = attempt < GEMINI_MAX_ATTEMPTS - 1;
      console.warn('⚠️ Gemini attempt failed:', {
        worker: input.prolificId,
        chartIndex: input.chartIndex,
        includeWorkerDrawing,
        attempt: attempt + 1,
        maxAttempts: GEMINI_MAX_ATTEMPTS,
        retriable,
        message: getErrorMessage(error),
      });

      if (!retriable || !hasNextAttempt) {
        break;
      }
    }
  }

  throw new Error(
    `No image data in Gemini response after ${GEMINI_MAX_ATTEMPTS} attempts` +
    (lastError ? ` (${getErrorMessage(lastError)})` : '')
  );
}

/**
 * Fetch image from URL or local path and convert to base64
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  // If it's a local path (starts with /), construct full URL
  // In production, this should point to your deployed site or storage bucket
  const fullUrl = imageUrl.startsWith('http') 
    ? imageUrl 
    : `https://chartvisannotation.web.app${imageUrl}`;

  let lastError: string | null = null;

  for (let attempt = 0; attempt < IMAGE_FETCH_RETRY_DELAYS_MS.length; attempt++) {
    const delayMs = IMAGE_FETCH_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      const response = await fetchWithTimeout(fullUrl, IMAGE_FETCH_TIMEOUT_MS);
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`;
        continue;
      }

      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer).toString('base64');
    } catch (error: any) {
      lastError = error?.message || String(error);
    }
  }

  throw new Error(
    `Failed to fetch image from ${fullUrl} after ${IMAGE_FETCH_RETRY_DELAYS_MS.length} attempts` +
    (lastError ? ` (last error: ${lastError})` : '')
  );
}
