const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v5.0 - Gemini 2.5 Flash via OpenRouter' }));

const SYSTEM = `You are a certified professional damage inspector and licensed general contractor (25+ yrs experience, ICC B1, I-CAR Gold certified, IICRC Water Damage certified).

ABSOLUTE RULES:
1. NEVER mention photo quality, blur, darkness, or image clarity. Analyze what you see regardless.
2. Only report damage clearly visible. Never fabricate or exaggerate defects.
3. When unsure of severity, always choose the LOWER rating.
4. A clean no-damage report is perfectly valid.
5. Cost estimates MUST reflect real 2026 US contractor market rates. Never use round numbers like $500, $1000, $2000.`;

function getPrompt(focusHint) {
  const focusBlock = focusHint
    ? `\n\n=== USER SELECTION - READ THIS FIRST ===\n${focusHint}\n=== END SELECTION INSTRUCTION ===\n\n`
    : '';
  return focusBlock + `Analyze this image for damage and defects. Return ONLY valid JSON with no markdown or extra text.

2026 US CONTRACTOR PRICING REFERENCE (use these as your anchors):

STRUCTURAL / PROPERTY:
- Hairline crack cosmetic <1mm: $170-$380
- Structural crack 3mm+: $920-$4,200
- Foundation crack minor: $680-$3,100; major: $5,500-$28,000
- Small drywall hole patch: $140-$310
- Full drywall panel replace: $420-$950
- Water-damaged drywall section: $490-$1,250
- Water stain + repaint small: $210-$520
- Mold remediation small area: $560-$1,600
- Mold remediation large/structural: $2,400-$9,500
- Wood rot repair small: $380-$1,100; structural: $1,800-$6,500
- Interior room repaint ~400sqft: $580-$1,050
- Exterior full house repaint: $4,800-$14,500

ROOFING:
- Missing/damaged shingles patch: $360-$1,050
- Moderate shingle damage section: $1,200-$5,100
- Full roof replacement average: $10,500-$24,000
- Gutter repair: $200-$720; full replacement: $1,150-$4,200

WINDOWS / DOORS:
- Window chip/crack repair: $140-$390
- Standard window replacement: $310-$760
- Large double-pane window: $580-$1,850
- Door repair: $200-$540; interior replace: $360-$1,050; exterior replace: $720-$2,500

FLOORING:
- Hardwood refinish: $4.00-$9.00/sqft
- Tile repair few tiles: $250-$760
- Full floor retile per sqft: $8-$22
- Carpet patch/repair: $200-$620

PLUMBING / ELECTRICAL:
- Minor leak fix: $200-$620
- Pipe section replacement: $620-$2,400
- Electrical outlet/switch: $175-$360
- Panel repair: $680-$3,100

VEHICLE (2026 rates):
- PDR small dent no paint: $175-$470
- Large dent with paint damage: $510-$1,520
- Single panel repaint scratch: $360-$1,080
- Surface rust small area: $250-$760
- Heavy structural rust: $1,250-$4,800
- Windshield chip repair: $70-$190
- Windshield full replacement: $290-$680
- Bumper repair: $360-$960; replace: $720-$1,850
- Side mirror replace: $175-$520

Identify ALL visible defects: cracks, water damage, impact damage, deterioration, structural issues, biological growth, missing/broken elements, vehicle damage.

severity: critical=immediate safety hazard / high=repair within 2-4 weeks / medium=repair 1-3 months / low=cosmetic only
confidence: high=clearly visible / medium=likely present / low=needs in-person check

CRITICAL PRICING RULE: Use realistic specific numbers based on the damage extent you see. NEVER use round numbers ending in 00 - use values like $340, $1,150, $2,380. Total cost = sum of all individual defect costs.

Return EXACTLY this JSON:
{"defects":[{"id":"1","type":"crack","severity":"high","confidence":"high","location":"where","dimensions":"size","description":"description","urgency":"repair_urgent","estimatedRepairCost":{"min":340,"max":780,"currency":"USD"}}],"overallCondition":"poor","conditionRationale":"one sentence why","summary":"2-3 sentence assessment","priorityAction":"most urgent repair","totalEstimatedCost":{"min":340,"max":780,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":"Cost estimates based on 2026 US market rates and may vary by region and contractor."}

If no damage visible: empty defects array, overallCondition excellent, all costs 0.`;
}

function parseJSON(text) {
  const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try { return JSON.parse(clean); } catch(e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Unexpected response format from AI');
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
    disclaimer:p.disclaimer||'Cost estimates based on 2026 US market rates.'
  };
}

app.post('/analyze', async (req, res) => {
  if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  const { imageBase64, mediaType = 'image/jpeg', focusHint } = req.body;
  if (!imageBase64||imageBase64.length<100) return res.status(400).json({ error: 'Valid imageBase64 required' });
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer':'https://snapinspect-ai-server.onrender.com',
        'X-Title':'SnapInspect AI',
      },
      body:JSON.stringify({
        model:'google/gemini-2.5-flash',
        messages:[
          {role:'system', content:SYSTEM},
          {role:'user', content:[
            {type:'image_url', image_url:{url:`data:${mediaType};base64,${imageBase64}`}},
            {type:'text', text:getPrompt(focusHint||null)},
          ]},
        ],
        temperature:0.1,
        max_tokens:2048,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(()=>'Unknown error');
      return res.status(response.status).json({ error:`OpenRouter error (${response.status}): ${errText}` });
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return res.status(500).json({ error:'No response from AI' });
    res.json(normalize(parseJSON(text)));
  } catch(e) {
    res.status(500).json({ error:e.message||'Analysis failed' });
  }
});

app.listen(PORT, () => console.log('SnapInspect AI v5.0 on port ' + PORT));
