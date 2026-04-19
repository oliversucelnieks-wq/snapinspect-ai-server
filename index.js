const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v6.1' }));

const SYSTEM = `You are a certified professional inspector, licensed general contractor, and project estimator with 25+ years experience. You handle: damage inspection, property assessment, renovation planning, new construction quotes (fences, decks, sheds, custom builds), landscaping, flooring, painting, plumbing, electrical, roofing, and any other home or commercial project.

ABSOLUTE RULES:
1. Read the user's description carefully — it tells you exactly what they need.
2. Never mention photo quality or image clarity.
3. Only report what is visible. Never fabricate.
4. A clean result (no damage, no issues) is perfectly valid.
5. Cost estimates MUST reflect real 2026 market rates for the user's location.`;

function getPricingRef(userLocation) {
  const loc = userLocation
    ? `User location: ${userLocation}. Adjust ALL prices to local contractor market rates for this specific area.`
    : 'Use 2026 US market rates.';
  return `${loc}

2026 PRICING REFERENCE — adjust for location:
DAMAGE REPAIR: hairline crack $170-$380; structural crack $920-$4,200; foundation minor $680-$3,100; major $5,500-$28,000; drywall patch $140-$310; drywall panel $420-$950; water stain+repaint $210-$520; mold small $560-$1,600; mold large $2,400-$9,500; wood rot small $380-$1,100; rot structural $1,800-$6,500
PAINTING: interior room $580-$1,050; full house exterior $4,800-$14,500; fence/deck stain $320-$1,800
ROOFING: patch $360-$1,050; section $1,200-$5,100; full replacement $10,500-$24,000; gutters $200-$720
WINDOWS/DOORS: chip repair $140-$390; window replace $310-$760; large window $580-$1,850; door repair $200-$540; exterior door $720-$2,500
FLOORING: hardwood refinish $4-$9/sqft; tile repair $250-$760; retile $8-$22/sqft; carpet $200-$620; LVP install $3-$8/sqft; hardwood install $6-$14/sqft
PLUMBING/ELECTRICAL: leak fix $200-$620; pipe section $620-$2,400; outlet/switch $175-$360; panel $680-$3,100
NEW CONSTRUCTION & BUILDS: wood fence (labor+materials) $18-$45/linear ft; vinyl fence $20-$55/linear ft; chain link $12-$28/linear ft; deck 12x16 $6,500-$18,000; pergola $4,000-$12,000; shed 10x12 $2,800-$9,000; retaining wall $25-$75/sqft; concrete pad $6-$12/sqft; driveway $3,500-$8,000; pathway $8-$18/sqft; landscaping basic $1,500-$5,000
INTERIOR PROJECTS: kitchen remodel basic $15,000-$35,000; bathroom remodel $8,000-$22,000; basement finish $25-$55/sqft; drywall new $2-$4/sqft installed; insulation $1.50-$4/sqft
VEHICLE: PDR small dent $175-$470; large dent+paint $510-$1,520; scratch repaint $360-$1,080; rust small $250-$760; rust structural $1,250-$4,800; windshield chip $70-$190; windshield replace $290-$680; bumper repair $360-$960

RULE: Use realistic specific numbers. NEVER use round numbers like $500, $1000, $2000. Use values like $340, $1,150, $2,380.`;
}

function getProjectMode(description) {
  if (!description) return 'inspect';
  const d = description.toLowerCase();
  if (d.match(/build|install|new|add|construct|fence|deck|shed|pergola|patio|driveway|landscap|lay|put up|erect/)) return 'build';
  if (d.match(/renovat|remodel|redo|update|upgrade|replace|refresh|modernize/)) return 'renovate';
  if (d.match(/fix|repair|damage|crack|leak|mold|rust|broken|replace/)) return 'repair';
  return 'assess';
}

function getInspectPrompt(focusHint, userLocation, description) {
  const focusBlock = focusHint ? `\n\n=== USER SELECTION - READ FIRST ===\n${focusHint}\n=== END ===\n\n` : '';
  const descBlock = description ? `\n\nUSER REQUEST: "${description}"\nRespond to this specific request. If it's about building something new, assess the space and provide a build plan. If it's about repairs, focus on damage. If it's about renovation, plan the renovation.` : '';
  return focusBlock + descBlock + `\n\nAnalyze this image. Return ONLY valid JSON.\n\n${getPricingRef(userLocation)}\n\nReturn EXACTLY this JSON:\n{"defects":[{"id":"1","type":"crack","severity":"high","confidence":"high","location":"where","dimensions":"size","description":"description","urgency":"repair_urgent","estimatedRepairCost":{"min":340,"max":780,"currency":"USD"}}],"overallCondition":"poor","conditionRationale":"why","summary":"2-3 sentence assessment","priorityAction":"most urgent action","totalEstimatedCost":{"min":340,"max":780,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":"Cost estimates based on 2026 market rates."}\n\nseverity: critical=immediate / high=urgent 2-4wks / medium=1-3mo / low=cosmetic\nconfidence: high=visible / medium=likely / low=needs check\nIf no damage/issues: empty defects, overallCondition excellent, costs 0.`;
}

function getRoomPrompt(description, userLocation) {
  const mode = getProjectMode(description);

  let modeInstructions = '';
  if (mode === 'build') {
    modeInstructions = `
MODE: NEW BUILD / CONSTRUCTION
The user wants to build or install something. Your job is:
1. Assess the space/area in the photos — dimensions if estimable, condition of ground/surface, any obstacles
2. Identify what needs to be done to prepare the space (clearing, grading, permits likely needed, etc.)
3. Provide a complete cost breakdown for the project as "defects" (use defect entries as project items/tasks)
4. Each "defect" entry = one project task (e.g. "Site preparation", "Fence posts", "Fence panels", "Gates", "Finishing/staining")
5. Set severity based on importance: critical=must do first / high=main work / medium=secondary / low=optional finishing
6. Set urgency: "required" for must-do items, "recommended" for optional items
7. overallCondition should reflect space readiness: excellent=ready to build / good=minor prep needed / fair=moderate prep / poor=major prep required`;
  } else if (mode === 'renovate') {
    modeInstructions = `
MODE: RENOVATION / REMODEL
The user wants to renovate or remodel a space. Your job is:
1. Assess current condition across all photos
2. Identify all existing damage or issues that must be fixed first
3. List all renovation tasks needed (each as a "defect" entry)
4. Include both repair items AND upgrade/replacement items
5. Sequence items logically: demolition/prep first, then structural, then mechanical, then finishing`;
  } else if (mode === 'repair') {
    modeInstructions = `
MODE: DAMAGE REPAIR
The user needs specific repairs. Your job is:
1. Find all visible damage across all photos
2. Prioritize repairs by urgency
3. Give detailed cost estimates for each repair`;
  } else {
    modeInstructions = `
MODE: GENERAL ASSESSMENT
Analyze all photos together. Identify issues, needs, and opportunities. Respond to the user's specific description if provided.`;
  }

  const descBlock = description ? `\n\nUSER'S PROJECT DESCRIPTION: "${description}"` : '';

  return `You are analyzing MULTIPLE photos of the same space or project area. Look at ALL images together as one complete picture — each photo may show a different angle, wall, or area.
${descBlock}
${modeInstructions}

${getPricingRef(userLocation)}

Return EXACTLY this JSON (use "defect" entries as project items or damage items depending on mode):
{"defects":[{"id":"1","type":"item name (e.g. Fence posts installation)","severity":"high","confidence":"high","location":"where in the space","dimensions":"size/quantity if estimable","description":"detailed professional description of this item or task","urgency":"repair_urgent","estimatedRepairCost":{"min":340,"max":780,"currency":"USD"}}],"overallCondition":"fair","conditionRationale":"one sentence explaining the overall state","summary":"2-3 sentence professional project summary","priorityAction":"first thing to do","totalEstimatedCost":{"min":340,"max":780,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":"Cost estimates based on 2026 market rates for the specified location."}

Total cost = sum of all items. For builds, list EVERY component as a separate item.`;
}

function getTutorialPrompt(defect, userLocation) {
  const isProjectItem = defect.urgency === 'required' || defect.urgency === 'recommended';
  const taskType = isProjectItem ? 'construction/installation task' : 'repair';

  return `You are a licensed contractor with 25+ years experience. Generate a detailed step-by-step guide for this specific ${taskType}.

TASK: ${defect.type || 'work item'}
Severity/Priority: ${defect.severity || 'medium'}
Location: ${defect.location || 'not specified'}
Description: ${defect.description || ''}
Size/Quantity: ${defect.dimensions || 'not specified'}

${getPricingRef(userLocation)}

Return ONLY valid JSON:
{
  "overview": "2-3 sentence explanation of what this task involves and why it matters",
  "difficulty": "Easy / Moderate / Advanced",
  "estimatedTime": "e.g. 1 day / 2-3 hours / 1 weekend",
  "diyRecommended": true,
  "safetyNotes": ["safety note 1"],
  "materials": [
    {"name": "Material name", "note": "specification or tip", "estimatedCost": "$X-$Y"},
    {"name": "Tool name", "note": "where to rent if expensive", "estimatedCost": "$X-$Y"}
  ],
  "totalMaterialCost": "$X-$Y",
  "steps": [
    {"title": "Step title", "description": "Detailed instructions for this step", "tip": "Pro tip or null"}
  ],
  "disclaimer": "Always follow local building codes and obtain permits where required."
}

Adjust material costs for ${userLocation || 'US'} local market rates. If permits are likely required mention that in safetyNotes.`;
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
      id:d.id||String(i+1), type:d.type||'Unknown item',
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

// Single image analysis
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

// Multi-image project/room analysis
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
  } catch(e) { res.status(500).json({ error:e.message||'Analysis failed' }); }
});

// Fix/build tutorial generation
app.post('/tutorial', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  const { defect, userLocation } = req.body;
  if (!defect) return res.status(400).json({ error: 'defect object required' });
  try {
    const text = await callOpenRouter([
      {role:'system', content:SYSTEM},
      {role:'user', content:getTutorialPrompt(defect, userLocation||null)},
    ]);
    res.json(parseJSON(text));
  } catch(e) { res.status(500).json({ error:e.message||'Tutorial generation failed' }); }
});

app.listen(PORT, () => console.log('SnapInspect AI v6.1 on port ' + PORT));
