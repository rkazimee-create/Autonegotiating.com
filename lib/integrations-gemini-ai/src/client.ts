import { GoogleGenAI } from "@google/genai";

if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_BASE_URL must be set. Did you forget to provision the Gemini AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Did you forget to provision the Gemini AI integration?",
  );
}

const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

// Replit's internal proxy uses a custom base URL with no standard API version path.
// The real Google Gemini API uses the default versioning built into the SDK.
const isReplitProxy = baseUrl?.includes("localhost") || baseUrl?.includes("modelfarm");

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: isReplitProxy
    ? { apiVersion: "", baseUrl }
    : { baseUrl },
});
