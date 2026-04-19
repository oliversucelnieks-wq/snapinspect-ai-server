const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v6.0' }));

const SYSTEM = `You are a certified professional damage inspector and licensed general contractor (25+ yrs experience, ICC B1, I-CAR Gold certified, IICRC Water Damage certified).

ABSOLUTE RULES:
1. NEVER mention photo quality, blur, darkness, or image clarity. Analyze what you see.
2. Only report damage clearly visible. Never fabricate or exaggerate defects.
3. When unsure of severity, always choose the LOWER rating.
4. A clean no-damage report is perfectly valid.
5. Cost estimates MUST reflect real 2026 market rates for the user's location. Never use round numbers.`;

function getPricingRef(userLocation) {
  const loc = userLocation ? `User location: ${userLocation}. Adjust all prices to local contractor market rates for this area.` : 'Use 2026 US market rates.';
  return `${loc}

2026 PRICING REFERENCE (adjust for location):
CRACKS: hairline <1mm $170-$380; structural 3mm+ $920-$4,200; foundation minor $680-$3,100; major $5,500-$28,000
WATER/MOLD: stain+paint $210-$520; mold small $560-$1,600; mold large $2,400-$9,500; rot small $380-$1,100; rot structural $1,800-$6,500
DRYWALL: hole patch $140-$310; full panel $420-$950; water-damaged section $490-$1,250
PAINT: interior room $580-$1,050; exterior house $4,800-$14,500
ROOFING: shingles patch $360-$1,050; section $1,200-$5,100; full replacement $10,500-$24,000; gutters $200-$720
WINDOWS/DOORS: chip repair $140-$390; standard window $310-$760; large double-pane $580-$1,850; door repair $200-$540; exterior door replace $720-$2,500
FLOORING: hardwood refinish $4-$9/sqft; tile repair $250-$760; retile $8-$22/sqft; carpet $200-$620
PLUMBING/ELECTRICAL: leak fix $200-$620; pipe section $620-$2,400; outlet/switch $175-$360; panel $680-$3,100
VEHICLE: PDR small dent $175-$470; large dent+paint $510-$1,520; scratch repaint $360-$1,080; rust small $250-$760; rust structural $1,250-$4,800; windshield chip $70-$190; windshield replace $290-$680; bumper repair $360-$960; replace $720-$1,850

PRICING RULE: Use realistic specific numbers. NEVER use round numbers ending in 00. Use values like $340, $1,150, $2,380.`;
}

function getInspectPrompt(focusHint, userLocation, description) {
  const focusBlock = focusHint ? `\n\n=== USER SELECTION - READ FIRST ===\n${focusHint}\n=== END ===\n\n` : '';
  const descBlock = description ? `\n\nUSER REQUEST: "${description}"\nAnalyze with this context in mind and prioritize findings relevant to this request.\n` : '';
  return focusBlock + descBlock + `Analyze this image for damage and defects. Return ONLY valid JSON.

${getPricingRef(userLocation)}

Return EXACTLY this JSON:
{"defects":[{"id":"1","type":"crack","severity":"high","confidence":"high","location":"where","dimensions":"size","description":"description","urgency":"repair_urgent","estimatedRepairCost":{"min":340,"max":780,"currency":"USD"}}],"overallCondition":"poor","conditionRationale":"why","summary":"2-3 sentence assessment","priorityAction":"most urgent repair","totalEstimatedCost":{"min":340,"max":780,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":"Cost estimates based on 2026 market rates."}

severity: critical=immediate safety / high=repair 2-4 weeks / medium=1-3 months / low=cosmetic
confidence: high=clearly visible / medium=likely / low=needs check
If no damage: empty defects array, overallCondition excellent, costs 0.`;
}

function getRoomPrompt(description, userLocation) {
  const descBlock = description ? `\n\nUSER REQUEST: "${description}"\nFocus your analysis on what is needed for this renovation/repair request.` : '';
  return `You are analyzing MULTIPLE photos of the same space or renovation project. Analyze all images together as a complete picture.
${descBlock}

${getPricingRef(userLocation)}

Identify ALL defects and repair needs across all photos. For renovation requests, also identify work needed even if not damaged (e.g. outdated fixtures, worn surfaces). Consolidate findings — don't repeat the same defect twice.

Return EXACTLY this JSON (same structure as single inspection):
{"defects":[{"id":"1","type":"water damage","severity":"high","confidence":"high","location":"bathroom ceiling","dimensions":"approx 40cm diameter","description":"Water stain with active seepage, likely from upstairs plumbing","urgency":"repair_urgent","estimatedRepairCost":{"min":490,"max":1250,"currency":"USD"}}],"overallCondition":"poor","conditionRationale":"why","summary":"2-3 sentence room assessment","priorityAction":"most urgent repair","totalEstimatedCost":{"min":490,"max":1250,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":"Cost estimates based on 2026 market rates for the specified location."}

severity/confidence same as single. Total cost = sum of all defects.`;
}

function getTutorialPrompt(defect, userLocation) {
  return `You are a licensed contractor with 25+ years experience. Generate a detailed DIY repair tutorial for this specific defect.

DEFECT: ${defect.type || 'damage'}
Severity: ${defect.severity || 'medium'}
Location: ${defect.location || 'not specified'}
Description: ${defect.description || ''}
Dimensions: ${defect.dimensions || 'not specified'}

${getPricingRef(userLocation)}

Return ONLY valid JSON:
{
  "overview": "2-3 sentence explanation of what the defect is and why it needs to be fixed",
  "difficulty": "Easy / Moderate / Advanced",
  "estimatedTime": "e.g. 2-4 hours",
  "diyRecommended": true,
  "safetyNotes": ["safety note 1", "safety note 2"],
  "materials": [
    {"name": "Patching compound", "note": "Pre-mixed, lightweight", "estimatedCost": "$12-$18"},
    {"name": "Sandpaper 120-grit", "estimatedCost": "$4-$8"},
    {"name": "Primer + paint", "note": "Match existing wall color", "estimatedCost": "$25-$45"}
  ],
  "totalMaterialCost": "$41-$71",
  "steps": [
    {"title": "Prepare the surface", "description": "Clean the crack and remove all loose material. Use a wire brush or putty knife to widen slightly for better adhesion.", "tip": "Blow out all dust before applying compound"},
    {"title": "Apply patching compound", "description": "Fill the crack in thin layers, allowing each to dry completely.", "tip": null}
  ],
  "disclaimer": "Always follow local building codes. For structural concerns, consult a licensed engineer."
}

If this defect should NOT be DIY (structural, electrical hazards, asbestos risk, major mold): set diyRecommended to false and explain in overview. Still provide materials and steps for a professional, but note in each step that a pro is required.

Adjust material costs for ${userLocation || 'US'} local market rates.`;
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
      id:d.id||String(i+1), type:d.type||'Unknown defect',
      severity:['low','medium','high','critical'].includes(d.severity)?d.severity:'medium',
      confidence:['high','medium','low'].includes(d.confidence)?d.confidence:'medium',
      location:d.location||'', dimensions:d.dimensions||'', description:d.description||'',
      urgency:d.urgency||'repair_soon',
      estimatedRepairCost:d.estimatedRepairCost||{min:0,max:0,currency:'USD'}
    })),
    overallCondition:['excellent','good','fair','poor','critical'].includes(p.overallCondition)?p.overallCondition:'fair',
    conditionRationale:p.conditionRationale||'',
    summary:p.summary||'Inspection complete.',
    priorityAction:p.priorityAction||'',
    totalEstimatedCost:p.totalEstimatedCost||{min:0,max:0,currency:'USD'},
    inspectionType:p.inspectionType||'other',
    professionalInspectionNeeded:!!p.professionalInspectionNeeded,
    disclaimer:p.disclaimer||'Cost estimates based on 2026 market rates.'
  };
}

async function callOpenRouter(messages) {
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
    const err = await response.text().catch(()=>'Unknown error');
    throw new Error(`OpenRouter error (${response.status}): ${err}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No response from AI');
  return text;
}

// ─── Single image analysis ────────────────────────────────────────────────────
app.post('/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  const { imageBase64, mediaType='image/jpeg', focusHint, userLocation, description } = req.body;
  if (!imageBase64||imageBase64.length<100) return res.status(400).json({ error: 'Valid imageBase64 required' });
  try {
    const text = await callOpenRouter([
      {role:'system', content:SYSTEM},
      {role:'user', content:[
        {type:'image_url', image_url:{url:`data:${mediaType};base64,${imageBase64}`}},
        {type:'text', text:getInspectPrompt(focusHint||null, userLocation||null, description||null)},
      ]},
    ]);
    res.json(normalize(parseJSON(text)));
  } catch(e) { res.status(500).json({ error:e.message||'Analysis failed' }); }
});

// ─── Multi-image room analysis ────────────────────────────────────────────────
app.post('/analyze-room', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  const { imagesBase64, description, userLocation } = req.body;
  if (!imagesBase64||!Array.isArray(imagesBase64)||imagesBase64.length===0) {
    return res.status(400).json({ error: 'imagesBase64 array required' });
  }
  try {
    const imageContent = imagesBase64.map(b64 => ({
      type:'image_url', image_url:{url:`data:image/jpeg;base64,${b64}`}
    }));
    const text = await callOpenRouter([
      {role:'system', content:SYSTEM},
      {role:'user', content:[
        ...imageContent,
        {type:'text', text:getRoomPrompt(description||null, userLocation||null)},
      ]},
    ]);
    res.json(normalize(parseJSON(text)));
  } catch(e) { res.status(500).json({ error:e.message||'Room analysis failed' }); }
});

// ─── Fix tutorial generation ──────────────────────────────────────────────────
app.post('/tutorial', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  const { defect, userLocation } = req.body;
  if (!defect) return res.status(400).json({ error: 'defect object required' });
  try {
    const text = await callOpenRouter([
      {role:'system', content:SYSTEM},
      {role:'user', content:getTutorialPrompt(defect, userLocation||null)},
    ]);
    const parsed = parseJSON(text);
    res.json(parsed);
  } catch(e) { res.status(500).json({ error:e.message||'Tutorial generation failed' }); }
});

app.listen(PORT, () => console.log('SnapInspect AI v6.0 on port ' + PORT));
