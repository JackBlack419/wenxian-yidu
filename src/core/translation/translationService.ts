import { createTranslator, getEngineCapabilities, testEngineConnection } from "./translationEngines";
import { DEFAULT_AI_PROMPT } from "./promptTemplate";
import { userFacingError, assertNotCancelled } from "./providerAdapters";
export { listModels } from "./listModels";

export interface TranslationSegment { id: string; text: string }
export interface SegmentTranslation {
  id: string; text: string; status: "success" | "error"; error?: string;
}
export interface SegmentTranslationRequest {
  segments: TranslationSegment[];
  sourceLanguage?: string;
  targetLanguage: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}
/** Shared by typed input, selection and document adapters. Failed text is explicit. */
export async function translateSegments(request: SegmentTranslationRequest): Promise<SegmentTranslation[]> {
  assertNotCancelled(request.signal);
  if (!request.targetLanguage?.trim()) throw new Error("请选择目标语言。");
  if (new Set(request.segments.map(s => s.id)).size !== request.segments.length) throw new Error("翻译段落标识重复。");
  const translator = createTranslator(request.targetLanguage, request.sourceLanguage, request.signal);
  const result: SegmentTranslation[] = new Array(request.segments.length);
  let cursor = 0, completed = 0;
  const worker = async () => {
    while (cursor < request.segments.length) {
      assertNotCancelled(request.signal);
      const i = cursor++;
      const segment = request.segments[i];
      try {
        // Preserve the pasted paragraph separators exactly; never send whitespace.
        const parts = segment.text.split(/(\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*)/);
        const output: string[] = [];
        for (let j = 0; j < parts.length; j++) {
          assertNotCancelled(request.signal);
          output.push(j % 2 || !parts[j].trim() ? parts[j] : await translator(parts[j], request.targetLanguage, request.sourceLanguage));
        }
        result[i] = { id: segment.id, text: output.join(""), status: "success" };
      } catch (error) {
        assertNotCancelled(request.signal);
        result[i] = { id: segment.id, text: "", status: "error", error: userFacingError(error) };
      }
      completed++;
      request.onProgress?.(completed, request.segments.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(getEngineCapabilities().concurrency, request.segments.length) }, worker));
  return result;
}
export const testConnection = testEngineConnection;
export function getDefaultPrompt(): string { return DEFAULT_AI_PROMPT; }
