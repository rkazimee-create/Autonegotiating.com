import { Router, type IRouter } from "express";
import { ai } from "@workspace/integrations-gemini-ai";

const router: IRouter = Router();

router.post("/deal-intelligence", async (req, res): Promise<void> => {
  const {
    year,
    make,
    model,
    trim,
    condition,
    price,
    mileage,
    accidents,
    oneOwner,
    ownerCount,
    usageType,
    marketAvg,
    marketMin,
    marketMax,
    pricePosition,
    avgDaysOnLot,
    pctWithPriceDrop,
    purchaseType,
    vin,
  } = req.body as Record<string, string | number | boolean>;

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  const vehicleDesc = [year, make, model, trim].filter(Boolean).join(" ");
  const conditionStr =
    condition === "new"
      ? "New"
      : condition === "certified" || condition === "cpo"
        ? "Certified Pre-Owned"
        : "Used";
  const priceStr = price ? `$${Number(price).toLocaleString()}` : "not provided";
  const mileageStr = mileage ? `${Number(mileage).toLocaleString()} miles` : "N/A (new)";
  const marketStr =
    marketAvg
      ? `Market avg: $${Number(marketAvg).toLocaleString()}, range $${Number(marketMin).toLocaleString()}–$${Number(marketMax).toLocaleString()}, price position: ${pricePosition ?? "unknown"}th percentile`
      : "No live market data — use your knowledge of this vehicle's current market pricing.";

  const inventoryPressureStr = [
    avgDaysOnLot ? `Comparable listings avg ${avgDaysOnLot} days on lot` : "",
    pctWithPriceDrop ? `${pctWithPriceDrop}% of comparable listings have had a recent price drop` : "",
  ]
    .filter(Boolean)
    .join("; ");

  const historyStr = [
    oneOwner === "1" || oneOwner === true || oneOwner === "true" ? "1 owner" : ownerCount ? `${ownerCount} owners` : "",
    accidents && Number(accidents) > 0 ? `${accidents} accident(s) reported` : "No accidents reported",
    usageType ? `Usage: ${usageType}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const purchaseLabel =
    purchaseType === "lease" ? "Lease" : purchaseType === "finance" ? "Financed" : "Cash";

  const priceNum = Number(price) || 0;

  const prompt = `You are an expert car buying advisor with deep knowledge of current dealer pricing, incentives, and negotiation tactics. Analyze this deal and provide a comprehensive, actionable assessment.

Vehicle: ${vehicleDesc}
Condition: ${conditionStr}
Listed Price: ${priceStr}
Mileage: ${mileageStr}
Vehicle History: ${historyStr || "Unknown"}
Market Data: ${marketStr}
Inventory Pressure: ${inventoryPressureStr || "No live inventory data — use your knowledge of typical market velocity for this vehicle."}
Purchase Type: ${purchaseLabel}
VIN: ${vin || "not provided"}

Based on your knowledge of this vehicle's current market (KBB, CarGurus, Edmunds TMV, community forums like Reddit r/askcarsales), provide your analysis in this EXACT JSON structure. No markdown, no code fences — just valid JSON:

{
  "offerStrategy": {
    "aggressive": {
      "price": <integer — lowest realistic offer, typically 8-12% below list>,
      "label": "Aggressive",
      "desc": "<1-2 sentences on strategy and expected dealer reaction>"
    },
    "recommended": {
      "price": <integer — best balance of savings vs. acceptance likelihood, typically 4-6% below list>,
      "label": "Recommended",
      "desc": "<1-2 sentences on why this is the sweet spot>"
    },
    "safe": {
      "price": <integer — very likely accepted, typically 1-3% below list>,
      "label": "Safe",
      "desc": "<1-2 sentences on this conservative approach>"
    }
  },
  "summary": "<2-3 sentences summarizing deal quality, whether the price is fair, and top action item>",
  "deals": [
    {
      "source": "<source name e.g. Reddit r/askcarsales, Edmunds Forums, CarGurus, TrueCar>",
      "price": <integer — realistic transaction price from that source>,
      "description": "<2-3 sentences describing what buyers at this source reported paying or experiencing for this vehicle. Be specific and realistic.>",
      "tags": ["<tag1>", "<tag2>"]
    }
  ],
  "marketStats": {
    "avgTransactionPrice": <integer>,
    "lowestReported": <integer>,
    "highestReported": <integer>,
    "avgDiscountOffMsrp": <integer — dollar amount off MSRP on average>,
    "avgDiscountPercent": <number — percent off MSRP>,
    "bestMonthToBuy": "<e.g. December, March (end of quarter)>",
    "daysOnLot": "<average days on lot as string>"
  },
  "fairMarketValue": {
    "kbb": {
      "dealerRetail": <integer — KBB dealer retail estimate>,
      "privateParty": <integer — KBB private party estimate if used>
    },
    "cargurus": {
      "avgListing": <integer — CarGurus average listing price>
    },
    "edmunds": {
      "tmv": <integer — Edmunds True Market Value>
    },
    "dealerInvoice": <integer — actual dealer invoice/cost for this vehicle; for new cars this is what the dealer paid the manufacturer; for used cars set to null>
  },
  "incentives": [
    {
      "name": "<incentive name, e.g. 'Toyota Customer Cash' or 'Special APR'>",
      "type": "<one of: Cash | APR | Lease | Loyalty | Military | College | Trade-In | CPO>",
      "amount": <integer — dollar value of rebate/cash incentive, or 0 for APR/lease deals>,
      "apr": "<string — e.g. '0.9% for 60 months' for APR offers, omit for cash>",
      "description": "<1-2 sentences on who qualifies and how to apply>",
      "expires": "<month and year, e.g. 'June 2025', or 'ongoing'>",
      "stackable": <boolean — can it be combined with other incentives?>
    }
  ],
  "negotiationTips": [
    "<specific tip 1 for this vehicle/situation>",
    "<specific tip 2>",
    "<specific tip 3>",
    "<specific tip 4>",
    "<specific tip 5>"
  ],
  "sources": ["Reddit r/askcarsales", "KBB", "CarGurus", "Edmunds", "TrueCar"],
  "dealScore": <integer 1-10>,
  "verdict": "<one of: Great Deal | Good Deal | Fair Deal | Overpriced>"
}

Important:
- All prices should be realistic for the current market (${new Date().getFullYear()})
- The listed price is ${priceStr} — base your offer strategy around this actual number
- Include 3-5 deal reports (deals array) from different community sources
- Be specific to this vehicle model, not generic advice
- If this is a new car, omit privateParty from kbb and populate dealerInvoice with a realistic estimate
- For used/CPO cars, set fairMarketValue.dealerInvoice to null
- Always include the incentives array — for new cars list all current manufacturer cash rebates, special APR offers, lease support, and loyalty/military/college bonuses you know about; for used cars include any applicable CPO benefits or dealer incentives; if truly none exist, return an empty array []`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 8192, temperature: 0.2 },
    });

    const text = response.text ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      req.log.error({ text }, "Gemini response missing JSON");
      res.status(502).json({ error: "Invalid AI response format" });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      req.log.error({ text, parseErr }, "Gemini JSON parse failed");
      res.status(502).json({ error: "Could not parse AI response" });
      return;
    }

    if (parsed.offerStrategy && priceNum > 0) {
      const strat = parsed.offerStrategy as Record<string, Record<string, number>>;
      if (!strat.aggressive?.price) strat.aggressive = { ...strat.aggressive, price: Math.round(priceNum * 0.91) };
      if (!strat.recommended?.price) strat.recommended = { ...strat.recommended, price: Math.round(priceNum * 0.95) };
      if (!strat.safe?.price) strat.safe = { ...strat.safe, price: Math.round(priceNum * 0.98) };
    }

    res.json({ raw: text, parsed });
  } catch (err) {
    req.log.error({ err }, "deal-intelligence failed");
    res.status(502).json({ error: "AI analysis failed" });
  }
});

export default router;
