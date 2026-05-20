/**
 * generate_base_images.mjs
 *
 * Reads public/{CHART_ASSET_FOLDER}/caption.json and generates baseline annotated PNGs
 * Writes to public/{CHART_ASSET_FOLDER}/baseImages/{chartId}.png (one baseline per chart).
 *
 * Caption shapes:
 * - pilot_v3 style: one string per chart → single output `{chartId}.png`.
 *
 * Usage:
 *   CHART_ASSET_FOLDER=pilot_v3 node onetime_scripts/generate_base_images.mjs
 *   CHART_IDS=2,4 node onetime_scripts/generate_base_images.mjs   # optional subset by chart id
 *
 * GEMINI_API_KEY: .env at project root or env var.
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
**Information:**
Caption: ${caption}

You will receive one image:
- **Original chart:** the base chart with no annotations. This is the fixed chart layer.

**Task:**
1. Analyze the caption together with the original chart. Identify both:
   - **What to express** — which data, regions, trends, comparisons, or relationships the caption emphasizes and that are supported by the chart.
   - **How to express it** — suitable visual emphasis (e.g. emphasis, grouping, direction, contrast) that connects the chart to the caption.
2. Draw visual annotations on top of the original chart based on the identified "What" and "How" in step 1.

When drawing the annotations, strictly follow all guidelines below.

**Guidelines:**
1. Use the original chart as the exact base image. Preserve the same pixel dimensions, aspect ratio, axes, labels, legends, and data marks. Only add annotations on top.

2. Use the caption and the chart for ideation of both what to annotate and how to annotate it. Choose emphasis that reflects the caption's message and what is feasible and appropriate in the chart.

3. Avoid clutter and redundancy. Each annotation should be concise, distinct and legible.

4. Use short, essential keywords or values for text annotations. Do not use full sentences or copy the caption.

5. Style visual annotations with expressive, polished styles for the highlight layer only. Leave the original chart as is.
`;
}

const CHART_ASSET_FOLDER = process.env.CHART_ASSET_FOLDER || 'pilot_v3';
const IMAGE_DIR = path.join(ROOT, 'public', CHART_ASSET_FOLDER);
const CAPTION_FILE = path.join(ROOT, 'public', CHART_ASSET_FOLDER, 'caption.json');
const OUTPUT_DIR = path.join(ROOT, 'public', CHART_ASSET_FOLDER, 'baseImages');

// pilot_v3: string;
function captionsForEntry(entry) {
  const raw = entry?.captions;
  if (Array.isArray(raw)) return raw.filter((c) => typeof c === 'string' && c.trim());
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

// Optional filter: CHART_IDS=2,4,6
function parseChartIdFilter() {
  const raw = process.env.CHART_IDS;
  if (!raw?.trim()) return null;
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n))
  );
}

const RETRY_DELAYS_MS = [0, 2000, 5000];

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
          { text: 'Original chart:' },
          {
            inlineData: {
              data: imageBase64,
              mimeType: 'image/png',
            },
          },
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
  const captionData = JSON.parse(fs.readFileSync(CAPTION_FILE, 'utf-8'));
  if (!Array.isArray(captionData)) {
    console.error('❌ caption.json must be a JSON array.');
    process.exit(1);
  }

  const idFilter = parseChartIdFilter();

  // @type {typeof captionData}
  const entries = idFilter
    ? captionData.filter((e) => idFilter.has(e.id))
    : captionData.slice();

  const totalJobs = entries.length;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  let successCount = 0;
  let failCount = 0;

  console.log(`Folder: ${CHART_ASSET_FOLDER}  |  Charts to process: ${entries.length}  |  Total images: ${totalJobs}`);

  for (const chartEntry of entries) {
    const chartId = chartEntry.id;
    const imageFile = chartEntry.filename || `${chartId}.png`;
    const imagePath = path.join(IMAGE_DIR, imageFile);
    if (!fs.existsSync(imagePath)) {
      console.error(`❌ Image not found: ${imagePath}`);
      continue;
    }

    const imageBase64 = fs.readFileSync(imagePath).toString('base64');
    const captionList = captionsForEntry(chartEntry);
    const caption = captionList[0];
    if (!caption) {
      console.error(`❌ No usable captions for chart id ${chartId}`);
      continue;
    }

    const outputFilename = `${chartId}_2.png`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    console.log(`\n🖼️  Generating ${outputFilename}`);
    console.log(`   Caption: "${caption}"`);

    try {
      const prompt = buildPrompt(caption);
      const resultBase64 = await generateWithRetry(ai, prompt, imageBase64);

      fs.writeFileSync(outputPath, Buffer.from(resultBase64, 'base64'));
      console.log(
        `   ✅ Saved → public/${CHART_ASSET_FOLDER}/baseImages/${outputFilename}`
      );
      successCount++;
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Success: ${successCount} / ${totalJobs}`);
  if (failCount > 0) console.log(`❌ Failed:  ${failCount}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
