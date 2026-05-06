/**
 * generate_base_images.mjs
 *
 * Generates annotated base images using Gemini for all chart × caption combinations.
 * Output: base_images/suneung{2,3,4}_{0,1,2,3}.png (12 images total)
 *
 * Usage:
 *   GEMINI_API_KEY=your_key node scripts/generate_base_images.mjs
 *
 * Or add GEMINI_API_KEY to .env at the project root.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Load API key ──────────────────────────────────────────────────────────────
const dotenvPath = path.join(ROOT, '.env');
if (fs.existsSync(dotenvPath)) {
  const lines = fs.readFileSync(dotenvPath, 'utf-8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY is not set. Add it to .env or pass as env var.');
  process.exit(1);
}

// ─── Prompt (edit this section) ───────────────────────────────────────────────
function buildPrompt(caption) {
  return `
Caption: ${caption}

**Task:** 
Please annotate this given chart based on the provided caption to make it more understandable.
When performing the annotation task, you must strictly adhere to all the instructions provided below.

**Instructions:**
1. No Invented Statistics: Use only the numerical values provided in the caption or chart. Do not calculate, estimate, or "hallucinate" new numbers that are not directly stated.
2. Eliminate Redundancy: Each annotation must be distinct. Avoid placing multiple labels that convey the same data point or insight to keep the visual clean.
`;
}
// ──────────────────────────────────────────────────────────────────────────────

const CHART_INDICES = [2, 3, 4];
const CAPTION_COUNT = 4;
const IMAGE_DIR = path.join(ROOT, 'public', 'suneung_images');
const CAPTION_FILE = path.join(ROOT, 'public', 'suneung_caption.json');
const OUTPUT_DIR = path.join(ROOT, 'base_images');

const RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 20000, 30000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(ai, prompt, imageBase64) {
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) await sleep(RETRY_DELAYS_MS[attempt]);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: [
          { text: prompt },
          { inlineData: { data: imageBase64, mimeType: 'image/png' } },
        ],
        config: { responseModalities: ['IMAGE'] },
      });

      for (const candidate of response?.candidates || []) {
        for (const part of candidate?.content?.parts || []) {
          if (part.inlineData?.data) return part.inlineData.data;
        }
      }

      const finishReason = response?.candidates?.[0]?.finishReason;
      console.warn(`  ⚠️  Attempt ${attempt + 1}: No image in response (finishReason: ${finishReason})`);
      lastError = new Error(`No image data (finishReason: ${finishReason})`);
    } catch (err) {
      console.warn(`  ⚠️  Attempt ${attempt + 1}: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`Failed after ${RETRY_DELAYS_MS.length} attempts: ${lastError?.message}`);
}

async function main() {
  // Load captions
  const captionData = JSON.parse(fs.readFileSync(CAPTION_FILE, 'utf-8'));

  // Prepare output directory
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  let successCount = 0;
  let failCount = 0;

  for (const chartIndex of CHART_INDICES) {
    const imagePath = path.join(IMAGE_DIR, `suneung${chartIndex}.png`);
    if (!fs.existsSync(imagePath)) {
      console.error(`❌ Image not found: ${imagePath}`);
      continue;
    }

    const imageBase64 = fs.readFileSync(imagePath).toString('base64');
    const chartCaptions = captionData.find((c) => c.id === chartIndex)?.captions;

    if (!chartCaptions) {
      console.error(`❌ Captions not found for chart index ${chartIndex}`);
      continue;
    }

    for (let captionIndex = 0; captionIndex < CAPTION_COUNT; captionIndex++) {
      const caption = chartCaptions[captionIndex];
      const outputFilename = `suneung${chartIndex}_${captionIndex}.png`;
      const outputPath = path.join(OUTPUT_DIR, outputFilename);

      console.log(`\n🖼️  Generating ${outputFilename}`);
      console.log(`   Caption: "${caption}"`);

      try {
        const prompt = buildPrompt(caption);
        const resultBase64 = await generateWithRetry(ai, prompt, imageBase64);

        fs.writeFileSync(outputPath, Buffer.from(resultBase64, 'base64'));
        console.log(`   ✅ Saved → base_images/${outputFilename}`);
        successCount++;
      } catch (err) {
        console.error(`   ❌ Failed: ${err.message}`);
        failCount++;
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Success: ${successCount} / ${CHART_INDICES.length * CAPTION_COUNT}`);
  if (failCount > 0) console.log(`❌ Failed:  ${failCount}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
