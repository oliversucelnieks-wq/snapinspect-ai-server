const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v2.2 running' }));
const SYSTEM = `You are a certified professional damage inspector (20+ yrs, ICC B1, I-CAR Gold).
ABSOLUTE RULES:
1. NEVER mention photo quality, blur, darkness, or image clarity. Small images are detail crops. Analyze what you see regardless.
2. Only report damage clearly visible. Never fabricate defects.
3. When unsure of severity, choose the LOWER rating.
4. A clean no-damage report is valid.`;
function getPrompt() {
  return `Analyze this image for damage. Return ONLY valid JSON, no markdown.
Mentally note the surface/material and any anomalies, then identify ALL defects:
cracks (hairline/fine/structural/settlement), water damage (stains/mold/efflorescence/rot), impact damage (dents/chips/holes/scratches), deterioration (peeling/rust/corrosion/spalling), structural issues (sagging/buckling), biological growth, missing/broken elements, vehicle damage.
severity: critical=immediate safety / high=repair 2-4 weeks / medium=1-3 months / low=cosmetic
confidence: high=clearly visible / medium=likely / low=needs physical check
JSON: {"defects":[{"id":"1","type":"crack","severity":"high","confidence":"high","location":"where","dimensions":"size","description":"professional description","urgency":"repair_urgent","estimatedRepairCost":{"min":300,"max":700,"currency":"USD"}}],"overallCondition":"poor","conditionRationale":"why","summary":"2-3 sentence assessment","priorityAction":"top action","totalEstimatedCost":{"min":300,"max":700,"currency":"USD"},"inspectionType":"property","professionalInspectionNeeded":true,"disclaimer":""}
If no damage: empty defects array, overallCondition excellent, costs 0.`;
}
function parseJSON(text) {
  const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try { return JSON.parse(clean); } catch(e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Unexpected AI response format');
  }
}
function normalize(p) {
  return {
    defects:(p.defects||[]).map((d,i)=>({
      id:d.id||String(i+1),type:d.type||'Unknown',
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
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  const { imageBase64, mediaType = 'image/jpeg' } = req.body;
  if (!imageBase64||imageBase64.length<100) return res.status(400).json({ error: 'Valid imageBase64 required' });
  const msgs = [{ role:'user', content:[
    { type:'image', source:{ type:'base64', media_type:mediaType, data:imageBase64 } },
    { type:'text', text:getPrompt() }
  ]}];
  try {
    let r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-beta':'interleaved-thinking-2025-05-14'},
      body:JSON.stringify({model:'claude-opus-4-6',max_tokens:5000,temperature:1,thinking:{type:'enabled',budget_tokens:1500},system:SYSTEM,messages:msgs})
    });
    if (!r.ok && r.status===400) {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:'claude-opus-4-6',max_tokens:2000,temperature:0,system:SYSTEM,messages:msgs})
      });
    }
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    const tb = data.content?.find(b=>b.type==='text');
    if (!tb) return res.status(500).json({ error:'No response from AI' });
    res.json(normalize(parseJSON(tb.text)));
  } catch(e) { res.status(500).json({ error:e.message||'Analysis failed' }); }
});
app.listen(PORT,()=>console.log('SnapInspect AI v2.2 on port '+PORT));
