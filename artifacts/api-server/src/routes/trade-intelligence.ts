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

  const now = new Date();
  const currentQtr = Math.ceil((now.getMonth() + 1) / 3);
  const currentYear = now.getFullYear();
  const lastQtr = currentQtr === 1 ? 4 : currentQtr - 1;
  const lastQtrYear = currentQtr === 1 ? currentYear - 1 : currentYear;
  const currentQuarter = `Q${currentQtr} ${currentYear}`;
  const lastQuarter = `Q${lastQtr} ${lastQtrYear}`;

  const isEv = /\b(tesla|ev|electric|rivian|lucid|polestar|ioniq|bolt|leaf|model [s3xy])\b/i.test(vehicleDesc);
  const isOlderLuxury = /\b(bmw|mercedes|audi|porsche|maserati|jaguar|land rover|cadillac|lincoln|infiniti|lexus)\b/i.test(vehicleDesc);
  const vehicleYear = parseInt(String(year)) || 0;
  const vehicleAge = vehicleYear > 0 ? new Date().getFullYear() - vehicleYear : 0;
  const highMileage = Number(mileage) > 100000;

  const prompt = `You are an expert automotive resale market analyst. Your job is to give ACCURATE, REALISTIC resale values that will hold up when the user checks them against live CarMax, Carvana, and KBB offers.

Vehicle: ${vehicleDesc}
Condition: ${conditionStr}
Mileage: ${mileageStr}
History: ${historyStr || "Unknown"}
VIN: ${vin || "not provided"}
Location: ${zip ? `ZIP ${zip}` : "unspecified — use national averages"}
Today: ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
${isEv ? `
⚠️  THIS IS AN ELECTRIC VEHICLE — APPLY EV DEPRECIATION RULES:
Electric vehicles, especially pre-2022 models, have experienced dramatic value declines of 40–65% since 2022-2023 due to Tesla's repeated price cuts, rapid EV technology advancement, battery degradation concerns, and surging competition. Do NOT use pre-2023 EV pricing data.
- A 2017–2019 Tesla Model S/X in Good condition typically fetches $12,000–$22,000 at CarMax/Carvana in 2024–2025 — NOT $30,000+.
- A 2017–2020 Tesla Model 3/Y trades for $14,000–$24,000 depending on trim and miles.
- For any EV older than 3 years, start from the BOTTOM of the market range, not the middle.
- KBB consistently over-values used EVs vs. what Carvana/CarMax actually pay — use Carvana/CarMax as the true floor.` : ''}${isOlderLuxury && vehicleAge > 5 ? `
⚠️  OLDER LUXURY VEHICLE — apply additional 10–15% haircut vs. standard KBB due to high maintenance costs suppressing buyer demand.` : ''}${highMileage ? `
⚠️  HIGH MILEAGE (100k+) — reduce all tiers by an additional 10–20% vs. standard KBB for this mileage bracket.` : ''}

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
      "reportDate": "<MUST be '${currentQuarter}' or '${lastQuarter}' — the current or immediately prior quarter ONLY. Do NOT include any report older than ${lastQuarter}. If you have no training data from these periods for this vehicle, include one entry with price null, description 'No forum reports found from ${lastQuarter} or ${currentQuarter} for this vehicle. Check Reddit r/askcarsales directly for the most current data.', and reportDate '${currentQuarter}'.>",
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
  "depreciation": {
    "annualLoss": "<e.g. '$3,200/year at current mileage and condition'>",
    "outlook12mo": "<1-2 sentences: where this vehicle's value is headed in the next 12 months — stable, declining fast, rising seasonally, etc.>",
    "urgencyNote": "<1 sentence: act now or wait — specific to this vehicle's trajectory>"
  },
  "negotiationScript": {
    "dealerOpener": "<exact opening line to say when trading in — reference THIS vehicle's specific strengths, e.g. low mileage, clean title, high-demand color>",
    "leveragePoints": [
      "<specific fact about this vehicle that gives you negotiating power — e.g. 'KBB Private Party for this mileage is $X, so your trade should be at least $Y'>",
      "<second leverage point — e.g. competing instant offers you can reference>",
      "<third leverage point — e.g. market demand or timing factor>"
    ],
    "redFlags": "<what it sounds like when a dealer is lowballing THIS specific vehicle — e.g. citing cosmetic issues that don't affect value, referencing auction prices for a retail-quality car>"
  },
  "competingListings": {
    "estimatedCount": "<e.g. '80–120 similar listings nationally'>",
    "avgAskingPrice": <integer — average private/dealer asking price for similar vehicles on AutoTrader/Cars.com>,
    "buyerLeverage": "<exactly one of: High | Moderate | Low — how much bargaining power a buyer has given supply>",
    "insight": "<1-2 sentences: does high supply hurt your selling price, or is demand strong enough to sustain value?>"
  },
  "taxSavingsTip": "<1-2 sentences: most states apply sales tax only to the net purchase price after trade-in. Mention the typical dollar savings of trading in vs selling private party for THIS vehicle's value, and whether that changes the overall recommendation.>",
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
8. If the vehicle is an EV (electric vehicle), use Carvana/CarMax actual transaction data as the anchor — NOT KBB (which over-values used EVs). EV instant offers are the best floor reference. Dealer trade-ins for older EVs run especially low.
9. Include exactly 4 platforms in instantOffers (KBB ICO, Carvana, CarMax, Vroom) in that order.
10. Include 3-5 community deal reports. ONLY use reports from ${currentQuarter} (highest priority) or ${lastQuarter}. Do NOT include anything older. If no data exists for these periods, say so explicitly rather than substituting older data.
11. Tips must be specific to this vehicle and condition — not generic advice.`;

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
