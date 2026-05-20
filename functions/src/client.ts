import { GoogleGenAI } from '@google/genai';

/** Input for one Gemini run: original chart + participant drawing (http(s) URLs, e.g. Firebase Storage). */
export interface GenerationInput {
  chartIndex: number;
  caption: string;
  prolificId: string;
  apiKey: string;
  /** Original stimulus chart (no annotations), e.g. {folder}/originalCharts/{n}.png */
  originalChartImageUrl: string;
  /** Participant export: chart underlay + Fabric highlights (JPEG). */
  workerDrawingImageUrl: string;
}

interface GenerationOutput {
  imgExpBase64: string;
}

/** Storage object path for the original chart image (chart id = n in originalCharts/n.png). */
export function getOriginalChartStoragePath(chartAssetFolder: string, chartIndex: number): string {
  const folder = chartAssetFolder.replace(/^\/+|\/+$/g, '');
  return `${folder}/originalCharts/${chartIndex}.png`;
}

/** Firebase Storage REST download URL (?alt=media); uses Storage rules, not GCS public ACL. */
export function getFirebaseStorageMediaUrl(bucketName: string, objectPath: string): string {
  const path = objectPath.replace(/^\/+/, '');
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media`;
}

function buildGeminiPrompt(
  input: Pick<GenerationInput, 'caption' | 'chartIndex' | 'prolificId'>
): string {
  return `
**Information:**
Caption: ${input.caption}

You will receive two images in order:
- **Image 1 — Original chart:** the base chart with no participant highlights. This is the fixed chart layer.
- **Image 2 — Participant drawing:** the same chart with the participant's rough visual highlights on top.

**Task:**
1. Compare Image 1 and Image 2. From the participant's drawing, identify both:
   - **What they are trying to express** — which data, regions, trends, comparisons, or relationships their highlights target, and how that connects to the caption.
   - **How they are trying to express it** — the communicative role of their marks (emphasis, grouping, direction, contrast, etc.).
2. Draw visual annotation on top of Image 1 based on the identified "What" and "How" in step 1.

When drawing the annotations, strictly follow all guidelines below.

**Guidelines:**
1. Use Image 1 as the exact base image. Preserve the same pixel dimensions, aspect ratio, axes, labels, legends, and data marks. Only add annotations on top.

2. Use participant's drawing(Image 2) as the guide for both what to annotate and how to annotate it. Figure out what the participant highlighted and how they visually emphasized it. Refine the drawn annotations added in Image 2 without tracing them exactly.

3. Avoid clutter and redundancy. Each annotation should be concise, distinct and legible.

4. Use short, essential keywords or values for text annotations. Do not use full sentences or copy the caption.

5. Style visual annotations with expressive, polished styles for the highlight layer only. Leave the chart base(Image 1) as is.
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

function assertHttpImageUrl(
  raw: string,
  label: string,
  prolificId: string,
  chartIndex: number
): string {
  const url = raw.trim();
  if (!url) {
    throw new Error(`Missing ${label} URL (worker=${prolificId}, chart=${chartIndex})`);
  }
  if (!HTTP_URL.test(url)) {
    throw new Error(
      `${label} must be http(s) (worker=${prolificId}, chart=${chartIndex}), got: ${url.slice(0, 72)}`
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

/** Experimental annotated chart: original chart + participant drawing → refined annotation image. */
export async function generateImgExp(
  input: GenerationInput
): Promise<GenerationOutput> {
  if (!input.apiKey) {
    throw new Error('Gemini API key not provided');
  }

  const originalUrl = assertHttpImageUrl(
    input.originalChartImageUrl,
    'originalChartImageUrl',
    input.prolificId,
    input.chartIndex
  );
  const drawingUrl = assertHttpImageUrl(
    input.workerDrawingImageUrl,
    'workerDrawingImageUrl',
    input.prolificId,
    input.chartIndex
  );

  const ai = new GoogleGenAI({ apiKey: input.apiKey });

  console.log(
    `🤖 Generating experimental annotated chart for worker ${input.prolificId}, chart ${input.chartIndex}`
  );

  const prompt = buildGeminiPrompt(input);

  try {
    const originalBase64 = await fetchHttpImageAsBase64(originalUrl);
    const drawingBase64 = await fetchHttpImageAsBase64(drawingUrl);

    const imgExpBase64 = await callGeminiImageModel(
      ai,
      prompt,
      input,
      originalBase64,
      drawingBase64
    );

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
  originalBase64: string,
  drawingBase64: string
): Promise<string> {
  const contents: any[] = [
    { text: prompt },
    { text: 'Image 1 — Original chart (fixed base; do not alter underlying chart pixels):' },
    {
      inlineData: {
        data: originalBase64,
        mimeType: 'image/png',
      },
    },
    {
      text: 'Image 2 — Participant drawing (chart + rough highlights; infer what they express and how they emphasize it—not pixels to copy):',
    },
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
    originalImageChars: originalBase64.length,
    drawingImageChars: drawingBase64.length,
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
