import { GoogleGenAI } from '@google/genai';

/** Input for one Gemini run: worker chart image is always an http(s) URL (e.g. Firebase Storage). */
export interface GenerationInput {
  chartIndex: number;
  caption: string;
  userIntent: string;
  prolificId: string;
  apiKey: string;
  workerDrawingImageUrl: string;
}

interface GenerationOutput {
  imgExpBase64: string;
}

function buildGeminiPrompt(
  input: Pick<GenerationInput, 'caption' | 'userIntent' | 'chartIndex' | 'prolificId'>
): string {
  return `
**Information:**
Caption: ${input.caption}
Intent: ${input.userIntent}

**Task:** 
Annotate the given chart based on the caption and the user's strategic intent to improve clarity and understanding.
Please follow the guidelines below when performing the annotation task.

**Guidelines:**
1. Data Fidelity
- Use only numerical values that are explicitly present in the chart or caption.
- If a value is unclear or not directly visible, avoid adding specific numbers.

2. Avoid Redundancy
- Try to make each annotation convey a unique insight.
`;
}

const IMAGE_FETCH_RETRY_DELAYS_MS = [0, 500, 1000];
const IMAGE_FETCH_TIMEOUT_MS = 2000;
const GEMINI_RETRY_DELAYS_MS = [0, 500, 1000];
const GEMINI_MAX_ATTEMPTS = GEMINI_RETRY_DELAYS_MS.length;

const HTTP_URL = /^https?:\/\//i;

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

  if (message.includes('no image data in gemini response')) return true;

  return false;
}

function assertWorkerDrawingHttpUrl(raw: string, prolificId: string, chartIndex: number): string {
  const url = raw.trim();
  if (!url) {
    throw new Error(`Missing worker drawing image URL (worker=${prolificId}, chart=${chartIndex})`);
  }
  if (!HTTP_URL.test(url)) {
    throw new Error(
      `workerDrawingImageUrl must be http(s) (worker=${prolificId}, chart=${chartIndex}), got: ${url.slice(0, 72)}`
    );
  }
  return url;
}

async function fetchHttpImageAsBase64(url: string): Promise<string> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt < IMAGE_FETCH_RETRY_DELAYS_MS.length; attempt++) {
    const delayMs = IMAGE_FETCH_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      const response = await fetchWithTimeout(url, IMAGE_FETCH_TIMEOUT_MS);
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
    `Failed to fetch image from ${url} after ${IMAGE_FETCH_RETRY_DELAYS_MS.length} attempts` +
      (lastError ? ` (last error: ${lastError})` : '')
  );
}

/**
 * Experimental annotated chart via Gemini using the participant’s drawing image URL + caption/intent prompt.
 */
export async function generateImgExp(
  input: GenerationInput
): Promise<GenerationOutput> {
  if (!input.apiKey) {
    throw new Error('Gemini API key not provided');
  }

  const drawingUrl = assertWorkerDrawingHttpUrl(
    input.workerDrawingImageUrl,
    input.prolificId,
    input.chartIndex
  );

  const ai = new GoogleGenAI({ apiKey: input.apiKey });

  console.log(
    `🤖 Generating experimental annotated chart for worker ${input.prolificId}, chart ${input.chartIndex}`
  );

  const prompt = buildGeminiPrompt(input);

  try {
    const drawingBase64 = await fetchHttpImageAsBase64(drawingUrl);
    const imgExpBase64 = await callGeminiImageModel(ai, prompt, input, drawingBase64);

    console.log(`✅ Experimental chart generated for worker ${input.prolificId}`);

    return { imgExpBase64 };
  } catch (error: any) {
    console.error(`❌ Gemini generation failed for worker ${input.prolificId}:`, error);
    throw new Error(`Gemini generation failed: ${error.message}`);
  }
}

async function callGeminiImageModel(
  ai: GoogleGenAI,
  prompt: string,
  input: GenerationInput,
  drawingBase64: string
): Promise<string> {
  const contents: any[] = [
    { text: prompt },
    {
      inlineData: {
        data: drawingBase64,
        mimeType: 'image/jpeg',
      },
    },
  ];

  console.log('🧪 Gemini request summary:', {
    worker: input.prolificId,
    chartIndex: input.chartIndex,
    promptLength: prompt.length,
    inputImageChars: drawingBase64.length,
  });

  let lastError: unknown = null;

  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt++) {
    const delayMs = GEMINI_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
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
        attempt: attempt + 1,
        candidates: response?.candidates?.length || 0,
        partKinds,
        finishReason: (firstCandidate as any)?.finishReason || null,
        promptFeedback: (response as any)?.promptFeedback || null,
      });

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

      console.error('❌ Gemini response structure (no image part):', JSON.stringify(response, null, 2));
      throw new Error('No image data in Gemini response');
    } catch (error: unknown) {
      lastError = error;
      const retriable = isRetriableGeminiError(error);
      const hasNextAttempt = attempt < GEMINI_MAX_ATTEMPTS - 1;
      console.warn('⚠️ Gemini attempt failed:', {
        worker: input.prolificId,
        chartIndex: input.chartIndex,
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
