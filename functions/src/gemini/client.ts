import { GoogleGenAI } from '@google/genai';
import { buildPrompt } from './prompts';
import { createCanvas, loadImage } from 'canvas';

interface GenerationInput {
  chartIndex: number;
  imageUrl: string;
  caption: string;
  userDrawingBase64: string;
  userIntent: string;
  prolificId: string;
  apiKey: string;
}

interface GenerationOutput {
  image1Base64: string;
  image2Base64: string;
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
  // Fetch original chart image
  const originalChartBase64 = await fetchImageAsBase64(input.imageUrl);

  // Determine which image to send to Gemini
  let finalImageBase64: string;
  
  if (includeWorkerDrawing && input.userDrawingBase64) {
    // Overlay worker drawing on top of original chart
    const userDrawingBase64Clean = input.userDrawingBase64.includes(',')
      ? input.userDrawingBase64.split(',')[1]
      : input.userDrawingBase64;
    
    finalImageBase64 = await overlayImages(originalChartBase64, userDrawingBase64Clean);
  } else {
    // Use original chart only
    finalImageBase64 = originalChartBase64;
  }

  const contents: any[] = [
    { text: prompt },
    { 
      inlineData: {
        data: finalImageBase64,
        mimeType: 'image/png',
      }
    }
  ];

  // Call Gemini with new SDK for image editing
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: contents,
  });

  // Extract generated image from response
  if (response.candidates && response.candidates[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) {
        return part.inlineData.data;
      }
    }
  }

  // Log the full response structure for debugging (only once)
  console.error('❌ Gemini response structure:', JSON.stringify(response, null, 2));
  throw new Error('No image data in Gemini response');
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

  const response = await fetch(fullUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${fullUrl}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

/**
 * Overlay worker drawing on top of original chart image
 */
async function overlayImages(chartBase64: string, drawingBase64: string): Promise<string> {
  try {
    // Load both images
    const chartBuffer = Buffer.from(chartBase64, 'base64');
    const drawingBuffer = Buffer.from(drawingBase64, 'base64');
    
    const chartImg = await loadImage(chartBuffer);
    const drawingImg = await loadImage(drawingBuffer);
    
    // Create canvas with chart dimensions
    const canvas = createCanvas(chartImg.width, chartImg.height);
    const ctx = canvas.getContext('2d');
    
    // Draw original chart first
    ctx.drawImage(chartImg, 0, 0);
    
    // Draw worker's drawing on top
    ctx.drawImage(drawingImg, 0, 0);
    
    // Convert to base64
    const overlaidBuffer = canvas.toBuffer('image/png');
    return overlaidBuffer.toString('base64');
  } catch (error: any) {
    console.error('Failed to overlay images:', error);
    throw new Error(`Image overlay failed: ${error.message}`);
  }
}
