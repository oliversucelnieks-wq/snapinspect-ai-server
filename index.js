const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v6.3' }));

const SYSTEM = `You are a professional inspector and estimator. You assess all types of items honestly.

THE MOST IMPORTANT RULE ABOUT COSTS:
Before giving ANY cost estimate, ask yourself: "How much does this item cost to buy brand new?"
- If a new one costs $1-5 (cheap toy, pen, small plastic item) → repair cost is $0-$2 max. It's almost always cheaper to replace it.
- If a new one costs $5-20 (small toy, book, basic item) → repair cost is $1-$8 max.
- If a new one costs $20-50 → repair cost should be at most $5-$25.
- The repair cost can NEVER exceed what the item costs new. Ever.
- For items under $10: just say "Replace it" with the replacement cost. Don't pretend $2 toys need $50 repairs.

ITEM CATEGORIES AND HOW TO PRICE THEM:
1. CHEAP CONSUMER ITEMS (toys, printed paper, pens, small decorations, $0.50-$10 items):
   - Give the replacement cost, not a repair cost
   - A $0.99 toy monkey with peeling paint: "Cost to replace: $1-$3"
   - A printed page: "Cost to reprint: $0.10-$0.50"
   - A broken cheap plastic item: "Cost to replace: $1-$5"

2. MID-RANGE CONSUMER ITEMS (books, clothes, small electronics, $10-$100):
   - Small repair: $2-$20 depending on complexity
   - Replacement: actual retail price

3. FURNITURE AND APPLIANCES ($50-$2000):
   - Minor repair: $15-$150
   - Major repair or replacement varies

4. PROPERTY/STRUCTURAL (walls, floors, roof, foundation):
   - Use contractor rates: cracks from $170, water damage from $490, roof from $360

5. VEHICLES:
   - Use auto body rates: dents $175+, paint $360+, windshield $70+

6. LOCATION: Adjust all prices to the user's local market.`;

function getItemPricing(userLocation) {
  const loc = userLocation ? `User location: ${userLocation}. Adjust prices for local market.` : 'Use standard market prices.';
  return loc;
}

function getProjectMode(description) {
  if (!description) return 'inspect';
  const d = description.toLowerCase();
  if (d.match(/build|install|new|add|construct|fence|deck|shed|pergola|patio|driveway|landscap|lay|put up|erect/)) return 'build';
  if (d.match(/renovat|remodel|redo|update|upgrade|replace|refresh|modernize/)) return 'renovate';
  return 'inspect';
}

function getInspectPrompt(focusHint, userLocation, description) {
  const focusBlock = focusHint ? `\n\n=== ANALYZE ONLY THIS SELECTED AREA ===\n${focusHint}\n=== END ===\n\n` : '';
  const descBlock = description ? `USER REQUEST: "${description}"\n` : '';
  return focusBlock + descBlock + `
${getItemPricing(userLocation)}

Analyze the image. Identify what the item actually is and how much it costs NEW, then price accordingly.

Return ONLY valid JSON:
{"defects":[{"id":"1","type":"peeling paint","severity":"low","confidence":"high","location":"toy body","dimensions":"small area","description":"Paint peeling on cheap plastic toy","urgency":"optional","estimatedRepairCost":{"min":1,"max":3,"currency":"USD"}}],"overallCondition":"fair","conditionRationale":"Minor cosmetic issue on low-value item","summary":"The toy has peeling paint. Given its low replacement cost of around $1-$3, replacing it is more practical than repairing it.","priorityAction":"Replace item for $1-$3","totalEstimatedCost":{"min":1,"max":3,"currency":"USD"},"inspectionType":"other","professionalInspectionNeeded":false,"disclaimer":"Repair cost based on actual item value and replacement availability."}

severity: critical=safety hazard / high=major damage / medium=noticeable / low=cosmetic
urgency: immediate / repair_urgent / repair_soon / low_priority / optional / replace_instead
If no damage: empty defects, overallCondition excellent, costs 0.`;
}

function getRoomPrompt(description, userLocation) {
  const mode = getProjectMode(description);
  let modeNote = '';
  if (mode === 'build') modeNote = 'User wants to BUILD something. Price the construction project.';
  else if (mode === 'renovate') modeNote = 'User wants to RENOVATE. List all tasks in order.';
  else modeNote = 'Assess all visible issues. Price each item based on its actual type and value.';

  const descBlock = description ? `USER PROJECT: "${description}"\n` : '';
  return `Analyze ALL photos as one space. ${descBlock}${modeNote}
${getItemPricing(userLocation)}

For each item, estimate costs based on what that specific item actually costs new.
Use the same JSON structure as single inspection.`;
}

function getTutorialPrompt(defect, userLocation) {
  return `Give a practical fix guide for: ${defect.type || 'damage'} (severity: ${defect.severity}, location: ${defect.location || 'unknown'}).
Description: ${defect.description || ''}

${getItemPricing(userLocation)}

IMPORTANT: If this is a cheap item (under $10 to replace), say so upfront and suggest replacement as the primary option. Only describe a repair if it genuinely makes economic sense.

Return JSON:
{
  "overview": "What this is, cost to replace new vs repair",
  "difficulty": "Easy / Moderate / Advanced",
  "estimatedTime": "e.g. 10 minutes",
  "diyRecommended": true,
  "safetyNotes": [],
  "materials": [{"name": "item", "note": "tip", "estimatedCost": "$X"}],
  "totalMaterialCost": "$X",
  "steps": [{"title": "step", "description": "details", "tip": null}],
  "disclaimer": "Consider replacement cost vs repair cost."
}`;
}

function parseJSON(text) {
  const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try { return JSON.parse(clean); } catch(e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Could not parse AI response');
  }
}

function normalize(p) {
  return {
    defects:(p.defects||[]).map((d,i)=>({
      id:d.id||String(i+1), type:d.type||'Issue',
      severity:['low','medium','high','critical'].includes(d.severity)?d.severity:'medium',
      confidence:['high','medium','low'].includes(d.confidence)?d.confidence:'medium',
      location:d.location||'', dimensions:d.dimensions||'', description:d.description||'',
      urgency:d.urgency||'repair_soon',
      estimatedRepairCost:d.estimatedRepairCost||{min:0,max:0,currency:'USD'}
    })),
    overallCondition:['excellent','good','fair','poor','critical'].includes(p.overallCondition)?p.overallCondition:'fair',
    conditionRationale:p.conditionRationale||'',
    summary:p.summary||'Analysis complete.',
    priorityAction:p.priorityAction||'',
    totalEstimatedCost:p.totalEstimatedCost||{min:0,max:0,currency:'USD'},
    inspectionType:p.inspectionType||'other',
    professionalInspectionNeeded:!!p.professionalInspectionNeeded,
    disclaimer:p.disclaimer||''
  };
}

async function callAI(messages) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://snapinspect-ai-server.onrender.com',
      'X-Title':'SnapInspect AI',
    },
    body:JSON.stringify({ model:'google/gemini-2.5-flash', messages, temperature:0.1, max_tokens:3000 }),
  });
  if (!r.ok) { const e = await r.text().catch(()=>'err'); throw new Error(`AI error (${r.status}): ${e}`); }
  const d = await r.json();
  const t = d.choices?.[0]?.message?.content;
  if (!t) throw new Error('No response');
  return t;
}

app.post('/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { imageBase64, mediaType='image/jpeg', focusHint, userLocation, description } = req.body;
  if (!imageBase64||imageBase64.length<100) return res.status(400).json({ error: 'imageBase64 required' });
  try {
    const text = await callAI([
      {role:'system', content:SYSTEM},
      {role:'user', content:[
        {type:'image_url', image_url:{url:`data:${mediaType};base64,${imageBase64}`}},
        {type:'text', text:getInspectPrompt(focusHint||null, userLocation||null, description||null)},
      ]},
    ]);
    res.json(normalize(parseJSON(text)));
  } catch(e) { res.status(500).json({ error:e.message||'Failed' }); }
});

app.post('/analyze-room', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { imagesBase64, description, userLocation } = req.body;
  if (!imagesBase64||!Array.isArray(imagesBase64)||imagesBase64.length===0) return res.status(400).json({ error: 'imagesBase64 required' });
  try {
    const text = await callAI([
      {role:'system', content:SYSTEM},
      {role:'user', content:[
        ...imagesBase64.map(b64=>({type:'image_url',image_url:{url:`data:image/jpeg;base64,${b64}`}})),
        {type:'text', text:getRoomPrompt(description||null, userLocation||null)},
      ]},
    ]);
    res.json(normalize(parseJSON(text)));
  } catch(e) { res.status(500).json({ error:e.message||'Failed' }); }
});

app.post('/tutorial', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { defect, userLocation } = req.body;
  if (!defect) return res.status(400).json({ error: 'defect required' });
  try {
    const text = await callAI([
      {role:'system', content:SYSTEM},
      {role:'user', content:getTutorialPrompt(defect, userLocation||null)},
    ]);
    res.json(parseJSON(text));
  } catch(e) { res.status(500).json({ error:e.message||'Failed' }); }
});

app.listen(PORT, () => console.log('SnapInspect AI v6.3 on port ' + PORT));
