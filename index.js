const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v6.2' }));

const SYSTEM = `You are a professional inspector, contractor, and estimator with 25+ years experience. You assess all types of items: property, vehicles, electronics, furniture, clothing, toys, documents, artwork, food, and anything else.

CRITICAL PRICING RULES:
1. ALWAYS identify what TYPE of item you are looking at before estimating costs.
2. Apply costs appropriate to that specific item type:
   - Consumer product (toy, book, clothing, small electronics, printed paper, decoration) = replacement cost from a store, typically $3-$80
   - Household furniture/appliance = repair or replacement cost, typically $20-$500
   - Property/structural (walls, floors, roof, foundation) = contractor repair rates
   - Vehicle = auto body/mechanical repair rates
   - Commercial equipment = specialist repair rates
3. NEVER apply contractor repair rates ($200-$5000) to cheap consumer items that cost $5-$50 to replace.
4. For peeling paint on a toy = just say "repaint with appropriate paint, $4-$12". Do NOT charge contractor rates.
5. For damaged paper/document = replacement cost only, $0-$20 for reprinting.
6. Cost estimates must reflect 2026 real market rates adjusted for the user's location.`;

function getItemContext(userLocation) {
  const loc = userLocation
    ? `User is in ${userLocation}. Adjust prices to local market rates for this area.`
    : 'Use 2026 market rates.';
  return loc;
}

function getPricingGuide() {
  return `PRICING BY ITEM TYPE (2026 rates):

CONSUMER/HOUSEHOLD ITEMS (cheap to replace/fix):
- Toy with peeling paint: repaint with craft paint $4-$12, or replace toy $8-$45
- Printed paper/document: reprint $0.10-$3, or replace if valuable $5-$25
- Small decoration/figurine: repair with glue/paint $2-$15, or replace $5-$60
- Children's book/magazine: replace $5-$25
- Clothing with small damage: sew/patch $2-$8, dry cleaning $8-$25
- Small electronics (phone screen crack): repair $40-$180, replace $80-$400
- Furniture scratch/dent: touch-up kit $8-$30, professional refinish $50-$200
- Curtains/bedding: replace $15-$120
- Kitchen items (chipped plate, cracked mug): replace $3-$25

PROPERTY/STRUCTURAL:
- Hairline crack cosmetic: $170-$380
- Structural crack 3mm+: $920-$4,200
- Foundation crack: $680-$28,000 depending on severity
- Drywall patch small: $140-$310
- Water damage/mold small: $490-$1,600
- Roof patch: $360-$1,050
- Full roof replacement: $10,500-$24,000
- Interior repaint room: $580-$1,050

VEHICLE:
- Small dent (PDR): $175-$470
- Large dent + repaint: $510-$1,520
- Scratch repaint panel: $360-$1,080
- Rust small area: $250-$760
- Windshield chip: $70-$190, replacement: $290-$680
- Bumper repair: $360-$960

NEW CONSTRUCTION/BUILD:
- Wood fence per linear ft: $18-$45
- Deck 12x16: $6,500-$18,000
- Shed 10x12: $2,800-$9,000
- Concrete pad per sqft: $6-$12

ALWAYS match your cost estimate to what makes sense for the actual item shown.`;
}

function getProjectMode(description) {
  if (!description) return 'inspect';
  const d = description.toLowerCase();
  if (d.match(/build|install|new|add|construct|fence|deck|shed|pergola|patio|driveway|landscap|lay|put up|erect/)) return 'build';
  if (d.match(/renovat|remodel|redo|update|upgrade|replace|refresh|modernize/)) return 'renovate';
  if (d.match(/fix|repair|damage|crack|leak|mold|rust|broken/)) return 'repair';
  return 'assess';
}

function getInspectPrompt(focusHint, userLocation, description) {
  const focusBlock = focusHint ? `\n\n=== USER SELECTION — ANALYZE ONLY THIS AREA ===\n${focusHint}\n=== END ===\n\n` : '';
  const descBlock = description ? `\nUSER REQUEST: "${description}"\n` : '';
  return focusBlock + descBlock + `
STEP 1: Identify exactly what type of item or surface you are looking at.
STEP 2: Apply appropriate pricing for THAT item type (not generic contractor rates).
${getPricingGuide()}
${getItemContext(userLocation)}

Analyze the image. Return ONLY valid JSON — no markdown, no explanation.

{"defects":[{"id":"1","type":"peeling paint","severity":"low","confidence":"high","location":"body of toy","dimensions":"approx 3cm area","description":"Paint peeling on plastic toy body, cosmetic damage only","urgency":"low_priority","estimatedRepairCost":{"min":4,"max":12,"currency":"USD"}}],"overallCondition":"fair","conditionRationale":"Minor cosmetic damage only","summary":"The toy has minor paint peeling on the body. This is purely cosmetic and can be touched up with craft paint.","priorityAction":"Optional: touch up with matching craft paint","totalEstimatedCost":{"min":4,"max":12,"currency":"USD"},"inspectionType":"other","professionalInspectionNeeded":false,"disclaimer":"Cost estimates reflect replacement/repair costs appropriate for this item type."}

severity: critical=immediate safety hazard / high=major damage / medium=noticeable damage / low=cosmetic only
urgency: immediate / repair_urgent / repair_soon / low_priority / optional
If no damage visible: empty defects array, overallCondition excellent, costs 0.`;
}

function getRoomPrompt(description, userLocation) {
  const mode = getProjectMode(description);
  let modeInstructions = '';
  if (mode === 'build') {
    modeInstructions = `MODE: BUILD/INSTALL — User wants to build something. Break the project into tasks. Use construction pricing.`;
  } else if (mode === 'renovate') {
    modeInstructions = `MODE: RENOVATE — Find existing damage first, then list all renovation tasks in sequence.`;
  } else if (mode === 'repair') {
    modeInstructions = `MODE: REPAIR — Find all visible damage and price repairs using appropriate rates for the item type.`;
  } else {
    modeInstructions = `MODE: ASSESS — Identify all issues and price them using appropriate rates for each item type.`;
  }

  const descBlock = description ? `USER'S PROJECT: "${description}"\n` : '';
  return `Analyze ALL photos together as one space/project.
${descBlock}${modeInstructions}

${getPricingGuide()}
${getItemContext(userLocation)}

Use the same JSON structure as single inspection. Total cost = sum of all items.`;
}

function getTutorialPrompt(defect, userLocation) {
  return `Generate a step-by-step repair/fix guide for this specific item.

ITEM/DEFECT: ${defect.type || 'damage'}
Severity: ${defect.severity || 'medium'}
Location: ${defect.location || 'not specified'}
Description: ${defect.description || ''}

FIRST: identify what type of item this is (toy, wall, car, furniture, etc.) and tailor your guide to that item.

${getItemContext(userLocation)}

Return ONLY valid JSON:
{
  "overview": "What this is and how to fix it",
  "difficulty": "Easy / Moderate / Advanced",
  "estimatedTime": "e.g. 30 minutes / 2 hours",
  "diyRecommended": true,
  "safetyNotes": ["any relevant safety note"],
  "materials": [{"name": "material name", "note": "where to buy / tip", "estimatedCost": "$X-$Y"}],
  "totalMaterialCost": "$X-$Y",
  "steps": [{"title": "Step title", "description": "Detailed instructions", "tip": "Pro tip or null"}],
  "disclaimer": "Brief note about costs varying"
}

Use prices appropriate for the actual item type. A toy repair should list craft paint ($4-$8), not contractor labor.`;
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
      id:d.id||String(i+1), type:d.type||'Unknown',
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
    disclaimer:p.disclaimer||'Cost estimates based on 2026 market rates.'
  };
}

async function callAI(messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://snapinspect-ai-server.onrender.com',
      'X-Title':'SnapInspect AI',
    },
    body:JSON.stringify({ model:'google/gemini-2.5-flash', messages, temperature:0.1, max_tokens:3000 }),
  });
  if (!response.ok) {
    const err = await response.text().catch(()=>'Unknown');
    throw new Error(`AI error (${response.status}): ${err}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No response from AI');
  return text;
}

app.post('/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { imageBase64, mediaType='image/jpeg', focusHint, userLocation, description } = req.body;
  if (!imageBase64||imageBase64.length<100) return res.status(400).json({ error: 'Valid imageBase64 required' });
  try {
    const text = await callAI([
      {role:'system', content:SYSTEM},
      {role:'user', content:[
        {type:'image_url', image_url:{url:`data:${mediaType};base64,${imageBase64}`}},
        {type:'text', text:getInspectPrompt(focusHint||null, userLocation||null, description||null)},
      ]},
    ]);
    res.json(normalize(parseJSON(text)));
  } catch(e) { res.status(500).json({ error:e.message||'Analysis failed' }); }
});

app.post('/analyze-room', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { imagesBase64, description, userLocation } = req.body;
  if (!imagesBase64||!Array.isArray(imagesBase64)||imagesBase64.length===0) {
    return res.status(400).json({ error: 'imagesBase64 array required' });
  }
  try {
    const text = await callAI([
      {role:'system', content:SYSTEM},
      {role:'user', content:[
        ...imagesBase64.map(b64 => ({type:'image_url', image_url:{url:`data:image/jpeg;base64,${b64}`}})),
        {type:'text', text:getRoomPrompt(description||null, userLocation||null)},
      ]},
    ]);
    res.json(normalize(parseJSON(text)));
  } catch(e) { res.status(500).json({ error:e.message||'Analysis failed' }); }
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
  } catch(e) { res.status(500).json({ error:e.message||'Tutorial failed' }); }
});

app.listen(PORT, () => console.log('SnapInspect AI v6.2 on port ' + PORT));
