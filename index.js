const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v7.0' }));

// ─── Parse location string "City, Country" into OpenRouter user_location object
function parseLocation(userLocation) {
  if (!userLocation) return null;
  const parts = userLocation.split(',').map(s => s.trim());
  return {
    type: 'approximate',
    city: parts[0] || undefined,
    country: parts[1] || undefined,
  };
}

// ─── Call AI without web search (for image analysis)
async function callAI(messages) {
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
      temperature: 0.1,
      max_tokens: 3000,
    }),
  });
  if (!r.ok) { const e = await r.text().catch(() => 'error'); throw new Error(`AI error (${r.status}): ${e}`); }
  const d = await r.json();
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error('No response from AI');
  return t;
}

// ─── Call AI WITH web search (for tutorials — finds real prices + stores)
async function callAIWithSearch(messages, userLocation) {
  const locationObj = parseLocation(userLocation);

  // Build the web search tool with location bias
  const webSearchTool = {
    type: 'openrouter:web_search',
    parameters: {
      max_results: 8,
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
      max_tokens: 4000,
    }),
  });

  if (!r.ok) { const e = await r.text().catch(() => 'error'); throw new Error(`AI error (${r.status}): ${e}`); }
  const d = await r.json();
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error('No response from AI');
  return t;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const INSPECT_SYSTEM = `You are a professional damage inspector and contractor. Identify defects and estimate repair costs accurately based on the type of item — cheap consumer items get replacement costs, structural/vehicle items get contractor rates.`;

function getInspectPrompt(focusHint, userLocation, description) {
  const focus = focusHint ? `\n\n=== ANALYZE ONLY THIS AREA ===\n${focusHint}\n=== END ===\n\n` : '';
  const desc = description ? `USER REQUEST: "${description}"\n` : '';
  const loc = userLocation ? `User location: ${userLocation}.\n` : '';
  return focus + desc + loc + `
Analyze the image. Before pricing, identify what the item actually is and what it costs new.
- Cheap consumer item ($1-10 new): give replacement cost only
- Mid-range item ($10-100 new): repair or replacement cost
- Property/structural: contractor rates
- Vehicle: auto body rates

Return ONLY valid JSON:
{"defects":[{"id":"1","type":"damage type","severity":"low","confidence":"high","location":"where","dimensions":"size","description":"description","urgency":"optional","estimatedRepairCost":{"min":1,"max":3,"currency":"USD"}}],"overallCondition":"fair","conditionRationale":"why","summary":"2-3 sentence assessment","priorityAction":"what to do","totalEstimatedCost":{"min":1,"max":3,"currency":"USD"},"inspectionType":"other","professionalInspectionNeeded":false,"disclaimer":"Costs reflect actual replacement/repair value for this item type."}

severity: critical/high/medium/low | urgency: immediate/repair_urgent/repair_soon/low_priority/optional
If no damage: empty defects, excellent condition, costs 0.`;
}

function getProjectMode(description) {
  if (!description) return 'inspect';
  const d = description.toLowerCase();
  if (d.match(/build|install|new|add|construct|fence|deck|shed|patio|driveway|landscap/)) return 'build';
  if (d.match(/renovat|remodel|redo|update|upgrade|modernize/)) return 'renovate';
  return 'inspect';
}

function getRoomPrompt(description, userLocation) {
  const mode = getProjectMode(description);
  const desc = description ? `PROJECT: "${description}"\n` : '';
  const loc = userLocation ? `Location: ${userLocation}.\n` : '';
  let modeNote = mode === 'build' ? 'User wants to BUILD. Break into tasks with realistic costs.'
    : mode === 'renovate' ? 'User wants to RENOVATE. List all tasks in order.'
    : 'Assess all visible issues with accurate costs for each item type.';
  return `Analyze ALL photos as one space. ${desc}${loc}${modeNote}
Price each item based on what it actually is (toy = replacement cost, wall = contractor rates).
Use same JSON structure as single inspection.`;
}

const TUTORIAL_SYSTEM = `You are a contractor and pricing expert. When asked for materials and prices, SEARCH THE WEB for actual current prices in the user's location. Do NOT guess or estimate from memory — search for real prices. Also SEARCH for actual stores near the user that sell these materials.`;

function getTutorialPrompt(defect, userLocation) {
  const loc = userLocation ? `User is in: ${userLocation}.` : '';
  return `Generate a complete repair/fix guide for this specific issue.

DEFECT: ${defect.type || 'damage'}
Severity: ${defect.severity || 'medium'}
Location: ${defect.location || 'unknown'}
Description: ${defect.description || ''}
Size: ${defect.dimensions || 'unknown'}
${loc}

IMPORTANT INSTRUCTIONS:
1. Search for the ACTUAL current retail price of each material in ${userLocation || 'the user\'s area'} (e.g. search "spray paint price [city]", "craft paint price [store]").
2. Search for actual stores near ${userLocation || 'the user'} that sell these materials (e.g. search "hardware stores near [city]", "craft stores near [city]", "[material] where to buy [city]").
3. Only include stores you actually find via search — never make up store names or addresses.
4. Only include prices you actually find via search — cite the source.

Return ONLY valid JSON (no markdown):
{
  "overview": "What this defect is and the best way to fix it",
  "difficulty": "Easy / Moderate / Advanced",
  "estimatedTime": "e.g. 30 minutes",
  "diyRecommended": true,
  "safetyNotes": ["safety note if needed"],
  "materials": [
    {
      "name": "material name",
      "note": "specification (e.g. 'acrylic craft paint, 59ml')",
      "estimatedCost": "actual price found (e.g. '$2.49 at Walmart')",
      "source": "where you found this price (store name or website)"
    }
  ],
  "totalMaterialCost": "sum of materials",
  "steps": [
    {"title": "Step name", "description": "Detailed instruction", "tip": "pro tip or null"}
  ],
  "nearbyStores": [
    {
      "name": "Store name (real, found via search)",
      "type": "Hardware store / Craft store / Supermarket / etc",
      "address": "address if found",
      "note": "which materials they carry"
    }
  ],
  "disclaimer": "Prices from web search and may vary. Check store for current availability."
}`;
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────
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

app.post('/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { imageBase64, mediaType = 'image/jpeg', focusHint, userLocation, description } = req.body;
  if (!imageBase64 || imageBase64.length < 100) return res.status(400).json({ error: 'imageBase64 required' });
  try {
    const text = await callAI([
      { role: 'system', content: INSPECT_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          { type: 'text', text: getInspectPrompt(focusHint || null, userLocation || null, description || null) },
        ],
      },
    ]);
    res.json(normalize(parseJSON(text)));
  } catch (e) { res.status(500).json({ error: e.message || 'Analysis failed' }); }
});

app.post('/analyze-room', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { imagesBase64, description, userLocation } = req.body;
  if (!imagesBase64 || !Array.isArray(imagesBase64) || imagesBase64.length === 0) {
    return res.status(400).json({ error: 'imagesBase64 array required' });
  }
  try {
    const text = await callAI([
      { role: 'system', content: INSPECT_SYSTEM },
      {
        role: 'user',
        content: [
          ...imagesBase64.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })),
          { type: 'text', text: getRoomPrompt(description || null, userLocation || null) },
        ],
      },
    ]);
    res.json(normalize(parseJSON(text)));
  } catch (e) { res.status(500).json({ error: e.message || 'Analysis failed' }); }
});

// Tutorial uses web search for real prices and stores
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

app.listen(PORT, () => console.log('SnapInspect AI v7.0 on port ' + PORT));
