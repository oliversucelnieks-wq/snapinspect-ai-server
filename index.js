const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v3.0 - Gemini 2.5 Flash' }));
const SYSTEM = `You are a certified professional damage inspector (20+ yrs, ICC B1, I-CAR Gold certified).
RULES: 1. NEVER mention photo quality, blur, or image clarity. 2. Only report clearly visible damage. Never fabricate. 3. When unsure of severity choose the LOWER rating. 4. A clean no-damage report is valid.`;
function getPrompt(focusHint) {
  const f = focusHint ? focusHint + '\n\n' : '';
  return f + `Analyze this image for damage. Return ONLY valid JSON, no markdown.
Identify ALL defects: cracks (hairline/fine/structural/settlement), water damage (stains/mold/efflorescence/rot), impact damage (dents/chips/holes/scratches), deterioration (peeling/rust/corrosion/spalling), structural issues (sagging/buckling), biological growth, missing/broken elements, vehicle damage.
severity: critical=immediate safety / high=repair 2-4 weeks / medium=1-3 months / low=cosmetic
confidence: high=clearly visible / medium=likely / low=needs physical check
JSON: {"defects":[{"id":"1","type":"crack","severity":"high","confidence":"high","location":"where","dimensions":"size","description":"professional description","urgency":"repair_urgent","estimatedRepairCost":{"min":300,"max":700,"currency":"USD"}}],"overallCondition":"poor","conditionRationale":"why","summary":"2-3 sentence assessment","priorityAction":"top action","totalEstimatedCost":{"min":300,"max":700,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":""}
If no damage: empty defects array, overallCondition excellent, costs 0.`;
}
function parseJSON(text) {
  const c = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try { return JSON.parse(c); } catch(e) {
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Unexpected response format');
  }
}
function normalize(p) {
  return {
    defects:(p.defects||[]).map((d,i)=>({id:d.id||String(i+1),type:d.type||'Unknown',
      severity:['low','medium','high','critical'].includes(d.severity)?d.severity:'medium',
      confidence:['high','medium','low'].includes(d.confidence)?d.confidence:'medium',
      location:d.location||'',dimensions:d.dimensions||'',description:d.description||'',
      urgency:d.urgency||'repair_soon',estimatedRepairCost:d.estimatedRepairCost||{min:0,max:0,currency:'USD'}})),
    overallCondition:['excellent','good','fair','poor','critical'].includes(p.overallCondition)?p.overallCondition:'fair',
    conditionRationale:p.conditionRationale||'',summary:p.summary||'Inspection complete.',
    priorityAction:p.priorityAction||'',totalEstimatedCost:p.totalEstimatedCost||{min:0,max:0,currency:'USD'},
    inspectionType:p.inspectionType||'other',professionalInspectionNeeded:!!p.professionalInspectionNeeded,disclaimer:p.disclaimer||''
  };
}
app.post('/analyze', async (req, res) => {
  if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'GOOGLE_API_KEY not configured' });
  const { imageBase64, mediaType = 'image/jpeg', focusHint } = req.body;
  if (!imageBase64||imageBase64.length<100) return res.status(400).json({ error: 'Valid imageBase64 required' });
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          system_instruction:{parts:[{text:SYSTEM}]},
          contents:[{parts:[{inline_data:{mime_type:mediaType,data:imageBase64}},{text:getPrompt(focusHint||null)}]}],
          generationConfig:{temperature:0.1,maxOutputTokens:2048}
        })
      }
    );
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      if (data.candidates?.[0]?.finishReason==='SAFETY') return res.status(400).json({ error:'Image blocked by safety filter.' });
      return res.status(500).json({ error:'No response from Gemini' });
    }
    res.json(normalize(parseJSON(text)));
  } catch(e) { res.status(500).json({ error:e.message||'Analysis failed' }); }
});
app.listen(PORT,()=>console.log('SnapInspect AI v3.0 Gemini 2.5 Flash on port '+PORT));
