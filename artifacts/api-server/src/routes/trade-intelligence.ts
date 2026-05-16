import { Router, type IRouter } from "express";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

router.post("/trade-intelligence", async (req, res): Promise<void> => {
  const {
    year, make, model, trim, condition,
    mileage, color, accidents, owners, zip, vin,
  } = req.body as Record<string, string | number>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  const vehicleDesc = [year, make, model, trim].filter(Boolean).join(" ");
  const conditionStr =
    ({ excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor" } as Record<string, string>)[String(condition)] ?? "Good";
  const mileageStr = mileage ? `${Number(mileage).toLocaleString()} miles` : "unknown";
  const historyStr = [
    accidents
      ? String(accidents) === "0" || String(accidents).toLowerCase().includes("clean")
        ? "Clean title — no accidents"
        : `${accidents} accident(s) on record`
      : "Clean title — no accidents reported",
    owners ? `${owners} owner(s)` : "",
    color ? `Exterior: ${color}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const prompt = `You are an expert automotive resale market analyst specializing in maximizing seller returns. Analyze the following vehicle across all selling channels and provide a data-backed, actionable multi-path value report.

Vehicle: ${vehicleDesc}
Condition: ${conditionStr}
Mileage: ${mileageStr}
History: ${historyStr || "Unknown"}
VIN: ${vin || "not provided"}
Location: ${zip ? `ZIP ${zip}` : "unspecified — use national averages"}
Today: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}

Provide your full analysis in this EXACT JSON structure. No markdown, no code fences — just valid JSON:

{
  "valueTiers": {
    "dealerTradeIn": {
      "low": <integer — lowest dealer trade-in offer to realistically expect>,
      "mid": <integer — typical fair dealer trade-in value; roughly 80-85% of retail>,
      "high": <integer — best dealer trade-in if negotiated well>,
      "desc": "<1-2 sentences: what to expect from dealer trade-ins for this exact vehicle>"
    },
    "instantOffer": {
      "low": <integer — conservative instant offer from Carvana/CarMax/KBB ICO>,
      "mid": <integer — typical instant offer midpoint; roughly 85-90% of retail>,
      "high": <integer — best realistic instant offer>,
      "desc": "<1-2 sentences: instant offer platform expectations for this vehicle>"
    },
    "privateParty": {
      "low": <integer — lowest realistic private sale price>,
      "mid": <integer — typical private party sale price; closest to full retail>,
      "high": <integer — optimistic asking price in a strong market>,
      "desc": "<1-2 sentences: private sale expectations — price premium vs effort and time required>"
    }
  },
  "recommendation": {
    "bestPath": "<exactly one of: Dealer Trade-In | Instant Offer | Private Party Sale>",
    "reasoning": "<3-4 sentences: specific reasoning why this path maximizes value for THIS vehicle and condition. Mention actual dollar differences between paths, time to sell, and any model-specific demand factors.>",
    "urgency": "<exactly one of: Sell Now | Flexible | Hold If Possible>"
  },
  "instantOffers": [
    {
      "source": "KBB Instant Cash Offer",
      "estimatedOffer": <integer>,
      "description": "<2 sentences on KBB ICO for this specific vehicle>",
      "pros": "<1 sentence — key advantage of this platform>",
      "cons": "<1 sentence — main downside>"
    },
    {
      "source": "Carvana",
      "estimatedOffer": <integer>,
      "description": "<2 sentences>",
      "pros": "<1 sentence>",
      "cons": "<1 sentence>"
    },
    {
      "source": "CarMax",
      "estimatedOffer": <integer>,
      "description": "<2 sentences>",
      "pros": "<1 sentence>",
      "cons": "<1 sentence>"
    },
    {
      "source": "Vroom",
      "estimatedOffer": <integer>,
      "description": "<2 sentences>",
      "pros": "<1 sentence>",
      "cons": "<1 sentence>"
    }
  ],
  "summary": "<2-3 sentences: this vehicle's current resale position, key demand drivers, and the single most important factor affecting its value right now>",
  "deals": [
    {
      "source": "<source: Reddit r/carbuying | Reddit r/askcarsales | Edmunds Forums | Facebook Marketplace | Cars.com Community>",
      "price": <integer — realistic transaction price sellers achieved>,
      "description": "<2-3 sentences: what sellers of similar vehicles reported — price achieved, time to sell, platform used, what helped or hurt>",
      "tags": ["<tag1>", "<tag2>"]
    }
  ],
  "marketStats": {
    "avgResalePrice": <integer — weighted average across all selling channels>,
    "avgDaysToSell": "<string — e.g. '14–21 days private party, same-day instant offer'>",
    "depreciationRate": "<string — e.g. '~11% per year at this mileage range'>",
    "demandLevel": "<exactly one of: High | Moderate | Low>",
    "bestTimeToSell": "<e.g. 'March–May (spring buying surge)' or 'September (new model year demand)'>"
  },
  "tips": [
    "<tip 1: specific and actionable for maximizing THIS vehicle's value — not generic>",
    "<tip 2>",
    "<tip 3>",
    "<tip 4>",
    "<tip 5>"
  ],
  "sources": ["KBB Instant Cash Offer", "Carvana", "CarMax", "Vroom", "Reddit r/askcarsales", "Edmunds Forums"],
  "tradeScore": <integer 1-10 — current market demand and sellability for this vehicle>,
  "verdict": "<exactly one of: Hot Market — Sell Now | Good Time to Sell | Neutral Market | Depreciation Risk — Act Fast>"
}

CRITICAL PRICING CALIBRATION — follow these rules exactly or the report will be wrong:
1. Anchor ALL values to KBB's actual published valuations for ${new Date().getFullYear()}, NOT to MSRP or dealer listing price.
2. privateParty.mid  = KBB Private Party Value "Good" condition for this mileage. This is always the highest tier.
3. dealerTradeIn.mid = KBB Trade-In Value "Good" condition. This is ALWAYS 15-25% LESS than KBB Private Party — dealers pay wholesale, not retail. Do not inflate this.
4. instantOffer.mid  = what Carvana / CarMax / KBB ICO actually pay today. This sits BETWEEN dealer trade-in and private party — typically 8-15% below KBB Private Party. KBB ICO and CarMax are usually within $300-$500 of each other.
5. For a ${conditionStr}-condition vehicle with ${mileageStr}, condition adjustments matter: Fair condition reduces values by an additional 10-15% vs Good; Poor by 20-25%.
6. Always give CONSERVATIVE estimates — users will compare these to real KBB pages and real Carvana offers. Overestimating damages credibility far more than underestimating.
7. Spread low/mid/high within each tier realistically (low ≈ mid minus 8-12%; high ≈ mid plus 5-8%).
8. Include exactly 4 platforms in instantOffers (KBB ICO, Carvana, CarMax, Vroom) in that order.
9. Include 3-5 community deal reports from distinct sources.
10. Tips must be specific to this vehicle and condition — not generic advice.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 8192, temperature: 0.2 },
    });

    const text = response.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      req.log.error({ text }, "Gemini response missing JSON for trade-intelligence");
      res.status(502).json({ error: "Invalid AI response format" });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      req.log.error({ text, parseErr }, "Gemini JSON parse failed for trade-intelligence");
      res.status(502).json({ error: "Could not parse AI response" });
      return;
    }

    res.json({ raw: text, parsed });
  } catch (err) {
    req.log.error({ err }, "trade-intelligence failed");
    res.status(502).json({ error: "AI analysis failed" });
  }
});

export default router;
