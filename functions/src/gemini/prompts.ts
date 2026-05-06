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
