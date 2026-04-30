interface PromptInput {
  caption: string;
  userIntent: string;
  chartIndex: number;
  prolificId: string;
}

/**
 * Build a prompt for Gemini to generate a clean annotated chart
 * based on the original chart + user's drawing overlay
 * 
 * @param input - Context about the chart, caption, and user's intent
 */
export function buildPrompt(input: PromptInput): string {
  return `
**Information:**
Caption: ${input.caption}
Intent: ${input.userIntent}

**Task:** 
Please annotate this figure based on the provided caption and the user's strategic intent to make it more understandable.
While annotating, please make sure to follow the instructions below.

**Instructions:**
- Strict Data Fidelity: Only use figures explicitly mentioned in the text or visible in the chart. Do not "hallucinate" or invent any additional statistics.
- Eliminate Redundancy: Each annotation must be distinct. Avoid placing multiple labels that convey the same data point or insight to keep the visual clean.
`;
}
