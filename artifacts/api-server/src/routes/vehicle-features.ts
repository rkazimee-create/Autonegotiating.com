import { Router, type IRouter } from "express";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

router.post("/vehicle-features", async (req, res): Promise<void> => {
  const { year, make, model, trim } = req.body as Record<string, string>;
  if (!make) {
    res.status(400).json({ error: "make is required" });
    return;
  }

  const vehicleDesc = [year, make, model, trim].filter(Boolean).join(" ");

  const prompt = `List the 10-12 most value-affecting optional features and packages commonly available or found on a ${vehicleDesc}. Include popular packages, trim-specific options, and add-ons that buyers specifically seek out and that meaningfully affect resale value on THIS vehicle.

Return ONLY a valid JSON array of short feature names (2-5 words each), sorted from highest to lowest resale value impact. No markdown, no code fences, no commentary — just the raw JSON array.

Example format: ["AWD / 4WD","Panoramic Sunroof","Leather Interior","Premium Audio","Navigation System","Heated Seats","Third Row Seating","Tow Package","Remote Start","Blind Spot Monitoring"]`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { thinkingConfig: { thinkingBudget: 0 } },
    });
    const text = (response.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const cleaned = text.replace(/```json?/gi, "").replace(/```/g, "").trim();
    const features: unknown = JSON.parse(cleaned);
    res.json({ features: Array.isArray(features) ? features : [] });
  } catch (err) {
    req.log.error({ err }, "vehicle-features generation failed");
    res.status(500).json({ error: "Failed to generate features" });
  }
});

export default router;
