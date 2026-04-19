const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v8.0' }));

// ─── Parse "City, Country" into user_location object for OpenRouter web search
function parseLocation(userLocation) {
  if (!userLocation) return null;
  const parts = userLocation.split(',').map(s => s.trim());
  const city = parts[0] || undefined;
  const country = parts[1] || undefined;
  return { type: 'approximate', city, country };
}

// ─── Plain AI call (for image analysis)
async function callAI(messages) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://snapinspect-ai-server.onrender.com',
      'X-Title': 'SnapInspect AI',
    },
    body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages, temperature: 0.1, max_tokens: 3500 }),
  });
  if (!r.ok) { const e = await r.text().catch(() => 'err'); throw new Error(`AI error (${r.status}): ${e}`); }
  const d = await r.json();
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error('No response from AI');
  return t;
}

// ─── AI call WITH web search — for tutorials
async function callAIWithSearch(messages, userLocation) {
  const locationObj = parseLocation(userLocation);
  const webSearchTool = {
    type: 'openrouter:web_search',
    parameters: {
      max_results: 10,
      max_total_results: 30, // allow the AI to make multiple searches for price + store inventory
      search_context_size: 'medium',
      ...(locationObj && { user_location: locationObj }),
    },
  };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://snapinspect-ai-server.onrender.com',
      'X-Title': 'SnapInspect AI',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages,
      tools: [webSearchTool],
      temperature: 0.1,
      max_tokens: 5000,
    }),
  });
  if (!r.ok) { const e = await r.text().catch(() => 'err'); throw new Error(`AI error (${r.status}): ${e}`); }
  const d = await r.json();
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error('No response from AI');
  return t;
}

// ─── Inspect prompt (same image analysis as before)
const INSPECT_SYSTEM = `You are a professional damage inspector, contractor, and project estimator. Assess items honestly. Cheap consumer items get replacement costs, property/vehicle items get contractor/auto-body rates. Repair costs should be realistic — never quote $200 to fix a $2 item.`;

function getProjectMode(description) {
  if (!description) return 'inspect';
  const d = description.toLowerCase();
  if (d.match(/build|install|construct|fence|deck|shed|patio|driveway|landscap/)) return 'build';
  if (d.match(/renovat|remodel|redo|upgrade|modernize/)) return 'renovate';
  return 'inspect';
}

function getInspectPrompt(focusHint, userLocation, description, photoCount) {
  const focus = focusHint ? `\n\n=== ANALYZE ONLY THIS AREA ===\n${focusHint}\n=== END ===\n\n` : '';
  const desc = description ? `USER REQUEST: "${description}"\n` : '';
  const loc = userLocation ? `User location: ${userLocation}.\n` : '';
  const multi = photoCount > 1 ? `You are looking at ${photoCount} photos of the same subject/space. Analyze them together as one complete picture — each photo may show a different angle, detail, or area. Consolidate findings — don't repeat the same defect twice.\n` : '';
  const mode = getProjectMode(description);
  let modeNote = '';
  if (mode === 'build') modeNote = 'USER WANTS TO BUILD SOMETHING. Break project into tasks (site prep, materials, installation, finishing). Use construction pricing.\n';
  else if (mode === 'renovate') modeNote = 'USER WANTS TO RENOVATE. List all tasks in logical order.\n';

  return focus + desc + loc + multi + modeNote + `
STEP 1: Identify what the item/space actually is and what it costs new (for consumer items) or what class of work it is (for property/construction).
STEP 2: Use pricing appropriate to that type — cheap items get replacement cost, structural work gets contractor rates.
STEP 3: Repair cost must never exceed reasonable replacement cost for cheap items.

Return ONLY valid JSON:
{"defects":[{"id":"1","type":"issue name","severity":"low","confidence":"high","location":"where","dimensions":"size","description":"description","urgency":"optional","estimatedRepairCost":{"min":1,"max":3,"currency":"USD"}}],"overallCondition":"fair","conditionRationale":"why","summary":"2-3 sentence assessment","priorityAction":"what to do","totalEstimatedCost":{"min":1,"max":3,"currency":"USD"},"inspectionType":"other","professionalInspectionNeeded":false,"disclaimer":"Costs reflect realistic values for this item type."}

severity: critical/high/medium/low | urgency: immediate/repair_urgent/repair_soon/low_priority/optional
If no damage: empty defects, excellent, costs 0.`;
}

// ─── Tutorial prompt — aggressive web search for real store inventory
const TUTORIAL_SYSTEM = `You are a practical repair expert. You MUST use the web_search tool aggressively to find REAL current prices and REAL stores near the user's location that actually sell each material. Never make up store names, addresses, prices, or inventory. Only report what you actually find in search results.`;

function getTutorialPrompt(defect, userLocation) {
  const loc = userLocation ? `User location: ${userLocation}` : 'User location: unknown (use general US market)';
  return `Generate a complete repair guide for this issue. You MUST use the web_search tool to look up REAL prices and REAL store inventory.

DEFECT: ${defect.type || 'damage'}
Severity: ${defect.severity || 'medium'}
Location in item: ${defect.location || 'unknown'}
Description: ${defect.description || ''}
Size: ${defect.dimensions || 'unknown'}
${loc}

REQUIRED WEB SEARCH WORKFLOW:
1. First, decide which materials are actually needed to fix this. Be realistic — a peeling toy doesn't need contractor epoxy, it needs craft paint.
2. For EACH material, do a web search like:
   - "[material name] price [city]" (e.g. "acrylic craft paint price Riga")
   - "[material] [local store chain name]"
3. For EACH material, ALSO search to find which specific stores near the user ACTUALLY STOCK IT:
   - "[material name] in stock [city]"
   - "buy [material] near [city]"
   - "[local hardware store/craft store] [material]"
   - Look at store websites when they appear in results
4. For each store you find in search results, VERIFY it's real by checking the search result mentions the store's name, location, and ideally confirms they sell the item.
5. Match each material to specific stores that carry it based on what search results show.

RULES:
- Only include stores that actually appear in your web search results. Never invent.
- Only include prices that you actually found via web search. Quote the source.
- If you can't find a store carrying an item, don't list a store for that item.
- Prefer stores local to ${userLocation || 'the user'} — chain stores AND local independent stores both count.
- If the user's location is in a non-English country, search in local store chains (e.g. for Latvia: Depo, K-Rauta, Lats, Rimi; for Germany: OBI, Bauhaus, Hornbach; for UK: B&Q, Wickes, Homebase; for Australia: Bunnings; etc.)

Return ONLY valid JSON (no markdown):
{
  "overview": "Explanation of what needs to be done",
  "difficulty": "Easy / Moderate / Advanced",
  "estimatedTime": "e.g. 30 minutes",
  "diyRecommended": true,
  "safetyNotes": ["if any"],
  "materials": [
    {
      "name": "Specific material name",
      "note": "specification",
      "estimatedCost": "€2.49 (actual price found)",
      "availableAt": ["Store A", "Store B"],
      "source": "URL or store name where price was found"
    }
  ],
  "totalMaterialCost": "sum based on real prices",
  "steps": [
    {"title": "Step", "description": "What to do", "tip": "optional tip"}
  ],
  "nearbyStores": [
    {
      "name": "Real store name found in search",
      "type": "Hardware store / Craft store / Supermarket / Online / etc",
      "address": "address if mentioned in search results, otherwise omit",
      "website": "store website if found",
      "carriesItems": ["Material A", "Material B"]
    }
  ],
  "disclaimer": "Prices from live web search. Verify stock before visiting."
}`;
}

// ─── Parsing and normalization
function parseJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(clean); } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Could not parse AI response');
  }
}

function normalize(p) {
  return {
    defects: (p.defects || []).map((d, i) => ({
      id: d.id || String(i + 1),
      type: d.type || 'Issue',
      severity: ['low','medium','high','critical'].includes(d.severity) ? d.severity : 'medium',
      confidence: ['high','medium','low'].includes(d.confidence) ? d.confidence : 'medium',
      location: d.location || '',
      dimensions: d.dimensions || '',
      description: d.description || '',
      urgency: d.urgency || 'repair_soon',
      estimatedRepairCost: d.estimatedRepairCost || { min: 0, max: 0, currency: 'USD' },
    })),
    overallCondition: ['excellent','good','fair','poor','critical'].includes(p.overallCondition) ? p.overallCondition : 'fair',
    conditionRationale: p.conditionRationale || '',
    summary: p.summary || 'Analysis complete.',
    priorityAction: p.priorityAction || '',
    totalEstimatedCost: p.totalEstimatedCost || { min: 0, max: 0, currency: 'USD' },
    inspectionType: p.inspectionType || 'other',
    professionalInspectionNeeded: !!p.professionalInspectionNeeded,
    disclaimer: p.disclaimer || '',
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Unified analyze endpoint — accepts imagesBase64 (array, 1 or many)
app.post('/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  // Accept both old format (single imageBase64) and new format (imagesBase64 array)
  let { imagesBase64, imageBase64, mediaType = 'image/jpeg', focusHint, userLocation, description } = req.body;
  if (!imagesBase64 && imageBase64) imagesBase64 = [imageBase64];
  if (!imagesBase64 || !Array.isArray(imagesBase64) || imagesBase64.length === 0) {
    return res.status(400).json({ error: 'imagesBase64 array required' });
  }

  try {
    const imageContent = imagesBase64.map(b64 => ({
      type: 'image_url',
      image_url: { url: `data:${mediaType};base64,${b64}` },
    }));
    const text = await callAI([
      { role: 'system', content: INSPECT_SYSTEM },
      {
        role: 'user',
        content: [
          ...imageContent,
          { type: 'text', text: getInspectPrompt(focusHint || null, userLocation || null, description || null, imagesBase64.length) },
        ],
      },
    ]);
    res.json(normalize(parseJSON(text)));
  } catch (e) { res.status(500).json({ error: e.message || 'Analysis failed' }); }
});

// Keep /analyze-room as an alias to /analyze for backwards compat
app.post('/analyze-room', async (req, res) => {
  req.url = '/analyze';
  app._router.handle(req, res, () => {});
});

// Tutorial with web search
app.post('/tutorial', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { defect, userLocation } = req.body;
  if (!defect) return res.status(400).json({ error: 'defect required' });
  try {
    const text = await callAIWithSearch(
      [
        { role: 'system', content: TUTORIAL_SYSTEM },
        { role: 'user', content: getTutorialPrompt(defect, userLocation || null) },
      ],
      userLocation || null
    );
    res.json(parseJSON(text));
  } catch (e) { res.status(500).json({ error: e.message || 'Tutorial failed' }); }
});

app.listen(PORT, () => console.log('SnapInspect AI v8.0 on port ' + PORT));
