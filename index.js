const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v4.0 - Gemini 2.5 Flash via OpenRouter' }));
const SYSTEM = `You are a certified professional damage inspector (20+ yrs, ICC B1, I-CAR Gold certified).
ABSOLUTE RULES:
1. NEVER mention photo quality, blur, darkness, or image clarity. Analyze what you see regardless.
2. Only report damage clearly visible. Never fabricate or exaggerate defects.
3. When unsure of severity, always choose the LOWER rating.
4. A clean no-damage report is perfectly valid.`;
function getPrompt(focusHint) {
  const f = focusHint ? focusHint + '\n\n' : '';
  return f + `Analyze this image for damage and defects. Return ONLY valid JSON with no markdown or extra text.
Identify ALL visible defects: cracks (hairline/fine/structural/settlement), water damage (stains/mold/efflorescence/rot), impact damage (dents/chips/holes/scratches), deterioration (peeling/rust/corrosion/spalling), structural issues (sagging/buckling), biological growth, missing/broken elements, vehicle damage.
severity: critical=immediate safety / high=repair 2-4 weeks / medium=1-3 months / low=cosmetic
confidence: high=clearly visible / medium=likely / low=needs physical check
Return this exact JSON structure:
{"defects":[{"id":"1","type":"crack","severity":"high","confidence":"high","location":"where","dimensions":"size","description":"professional description","urgency":"repair_urgent","estimatedRepairCost":{"min":300,"max":700,"currency":"USD"}}],"overallCondition":"poor","conditionRationale":"why","summary":"2-3 sentence assessment","priorityAction":"top action","totalEstimatedCost":{"min":300,"max":700,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":""}
If no damage visible: empty defects array, overallCondition excellent, costs 0, summary stating no damage found.`;
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
      id:d.id||String(i+1),type:d.type||'Unknown defect',
      severity:['low','medium','high','critical'].includes(d.severity)?d.severity:'medium',
      confidence:['high','medium','low'].includes(d.confidence)?d.confidence:'medium',
      location:d.location||'',dimensions:d.dimensions||'',description:d.description||'',
      urgency:d.urgency||'repair_soon',estimatedRepairCost:d.estimatedRepairCost||{min:0,max:0,currency:'USD'}
    })),
    overallCondition:['excellent','good','fair','poor','critical'].includes(p.overallCondition)?p.overallCondition:'fair',
    conditionRationale:p.conditionRationale||'',summary:p.summary||'Inspection complete.',
    priorityAction:p.priorityAction||'',totalEstimatedCost:p.totalEstimatedCost||{min:0,max:0,currency:'USD'},
    inspectionType:p.inspectionType||'other',professionalInspectionNeeded:!!p.professionalInspectionNeeded,disclaimer:p.disclaimer||''
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
          {role:'system',content:SYSTEM},
          {role:'user',content:[
            {type:'image_url',image_url:{url:`data:${mediaType};base64,${imageBase64}`}},
            {type:'text',text:getPrompt(focusHint||null)},
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
  } catch(e) { res.status(500).json({ error:e.message||'Analysis failed' }); }
});
app.listen(PORT,()=>console.log('SnapInspect AI v4.0 Gemini 2.5 Flash / OpenRouter on port '+PORT));
