// Gemini 2.5 Flash API wrapper for agent reasoning and risk scoring
// v3 -- Task 110: thinking-model fix (filter thought parts)
// Note: Cadenza monitoring maxTokens bumped 2048→4096 in index.tsx (Task 112) to prevent truncated JSON on multi-risk-factor scenarios

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

interface GeminiRequest {
  contents: GeminiMessage[];
  systemInstruction?: { parts: { text: string }[] };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
  };
}

const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_MS = 1000; // 1s, 2s, 4s backoff

export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    history?: GeminiMessage[];
  }
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable not set");
  }

  const contents: GeminiMessage[] = [
    ...(options?.history || []),
    { role: "user", parts: [{ text: userPrompt }] },
  ];

  const body: GeminiRequest = {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens ?? 4096,
      ...(options?.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const bodyJson = JSON.stringify(body);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyJson,
      });

      // Retry on 429 (rate limit) or 503 (overloaded) with exponential backoff
      if ((response.status === 429 || response.status === 503) && attempt < GEMINI_MAX_RETRIES) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : GEMINI_RETRY_BASE_MS * Math.pow(2, attempt); // 1s → 2s → 4s
        console.log(`[callGemini] ${response.status} — retry ${attempt + 1}/${GEMINI_MAX_RETRIES} in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`Gemini API error (${response.status}): ${errorText}`);
        throw new Error(`Gemini API error: ${response.status} - ${errorText.slice(0, 300)}`);
      }

      const data = await response.json();

      // Gemini 2.5 Flash is a "thinking" model — responses may include multiple parts:
      // parts[0] = { thought: true, text: "thinking..." }, parts[1] = { text: "actual JSON" }
      // We need the LAST non-thought part, not parts[0].
      const parts = data?.candidates?.[0]?.content?.parts || [];
      console.log(`[callGemini] Response parts count: ${parts.length}, thought flags: [${parts.map((p: any) => p.thought ?? false).join(', ')}]`);
      
      // Find the last non-thought part (the actual response)
      const responsePart = parts.filter((p: any) => !p.thought).pop();
      const text = responsePart?.text;

      if (!text) {
        console.log("Gemini returned empty response:", JSON.stringify(data).slice(0, 1000));
        throw new Error("Gemini returned empty response");
      }

      console.log(`[callGemini] Extracted text (first 300 chars): ${text.slice(0, 300)}`);
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Only retry on network errors (not API validation errors)
      if (attempt < GEMINI_MAX_RETRIES && lastError.message.includes("fetch")) {
        const delayMs = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt);
        console.log(`[callGemini] Network error — retry ${attempt + 1}/${GEMINI_MAX_RETRIES} in ${delayMs}ms: ${lastError.message}`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error("Gemini call failed after retries");
}

export async function callGeminiJSON<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<T> {
  const text = await callGemini(systemPrompt, userPrompt, {
    ...options,
    maxTokens: options?.maxTokens ?? 8192, // Higher default for JSON mode to prevent truncation
    jsonMode: true,
  });

  console.log(`[callGeminiJSON] Raw Gemini text (first 1000 chars): ${text.slice(0, 1000)}`);
  try {
    const parsed = JSON.parse(text) as T;
    console.log(`[callGeminiJSON] Parsed keys: ${Object.keys(parsed as any).join(', ')}`);
    return parsed;
  } catch (e) {
    console.log("Failed to parse Gemini JSON response:", text.slice(0, 500));
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as T;
      } catch (_) {
        // Fall through to truncation repair
      }
    }

    // ── Truncated JSON repair ──
    // Gemini sometimes returns JSON truncated mid-string due to token limits.
    // Attempt to close open strings, arrays, and objects to salvage the response.
    const repaired = repairTruncatedJSON(text);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as T;
        console.log(`[callGeminiJSON] Repaired truncated JSON successfully. Keys: ${Object.keys(parsed as any).join(', ')}`);
        return parsed;
      } catch (_) {
        // Repair wasn't sufficient
      }
    }

    throw new Error(`Failed to parse Gemini JSON: ${(e as Error).message}`);
  }
}

/**
 * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
 * Returns null if the input doesn't look like JSON at all.
 */
function repairTruncatedJSON(text: string): string | null {
  let s = text.trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return null;

  // Close any unterminated string (odd number of unescaped quotes)
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && inString) { i++; continue; }
    if (s[i] === '"') inString = !inString;
  }
  if (inString) {
    // Truncate back to last complete-looking content and close the string
    s += '"';
  }

  // Remove trailing comma (invalid before closing bracket)
  s = s.replace(/,\s*$/, '');

  // Count open braces/brackets and close them
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && inStr) { i++; continue; }
    if (s[i] === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (s[i] === '{') stack.push('}');
    else if (s[i] === '[') stack.push(']');
    else if (s[i] === '}' || s[i] === ']') stack.pop();
  }

  // Close all remaining open structures
  while (stack.length > 0) {
    s += stack.pop();
  }

  return s;
}