———const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.get('/', (req, res) => res.json({ status: 'SnapInspect AI v2.0 running' }));

const SYSTEM = `You are a certified professional damage inspector (20+ yrs experience, ICC B1, I-CAR Gold certified).
RULES YOU MUST FOLLOW:
1. ONLY report damage you can clearly see. Never fabricate or exaggerate.
2. If image is blurry or angle is bad, say so explicitly.
3. When uncertain about severity, always choose the LOWER rating.
4. A clean "no damage" report is valid and good - never invent defects to appear thorough.
5. Use precise professional terminology an insurance adjuster would recognize.`;

function getPrompt() {
      return `Analyze this image using a two-step method to ensure accuracy:

      STEP 1 - DESCRIBE WHAT YOU SEE (do this before identifying any defects):
      State the surface material, overall appearance, image quality, and any visible anomalies.

      STEP 2 - IDENTIFY DEFECTS (based ONLY on your Step 1 description):
      Look for: cracks (hairline/fine/structural/settlement), water damage (stains/mold/rot/efflorescence), impact damage (dents/chips/holes/scratches), surface deterioration (peeling paint/rust/corrosion/spalling), structural issues (sagging/buckling), biological growth (mold/algae/rot), missing or broken elements, vehicle damage (dents/scratches/glass cracks/bumper).

      For each defect assign:
      - confidence: "high" (clearly visible) / "medium" (likely but uncertain) / "low" (possible, needs in-person check)
      - severity: "critical" (immediate safety risk) / "high" (repair in 2-4 weeks) / "medium" (repair in 1-3 months) / "low" (cosmetic, 6 months)

      Return ONLY this JSON, no markdown, no extra text:
      {"imageQuality":"good|fair|poor","surfaceDescription":"what you see in step 1","defects":[{"id":"1","type":"exact defect name","severity":"low|medium|high|critical","confidence":"high|medium|low","location":"precise location in image","dimensions":"size estimate or cannot determine","description":"professional description: what it is, characteristics, likely cause, implications if untreated","urgency":"none|monitor|repair_soon|repair_urgent|emergency","estimatedRepairCost":{"min":0,"max":0,"currency":"USD"}}],"overallCondition":"excellent|good|fair|poor|critical","conditionRationale":"one sentence why","summary":"2-3 sentence professional summary with top recommended action","priorityAction":"single most important action for owner","totalEstimatedCost":{"min":0,"max":0,"currency":"USD"},"inspectionType":"property|vehicle|structural|roof|floor|other","professionalInspectionNeeded":false,"disclaimer":"note any low-confidence findings or limitations"}

      CRITICAL: If no damage visible, return overallCondition "excellent", empty defects array, costs 0, and state no damage found clearly in summary.`;
}

function parseJSON(text) {
      const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      try { return JSON.parse(clean); }
      catch(e) {
              const m = clean.match(/\{[\s\S]*\}/);
              if (m) return JSON.parse(m[0]);
              throw new Error('Could not parse AI response');
      }
}

function normalize(p) {
      return {
              defects: (p.defects||[]).map((d,i) => ({
                        id: d.id||String(i+1),
                        type: d.type||'Unknown defect',
                        severity: ['low','medium','high','critical'].includes(d.severity)?d.severity:'medium',
                        confidence: d.confidence||'medium',
                        location: d.location||'Not specified',
                        dimensions: d.dimensions||'Not determined',
                        description: d.description||'',
                        urgency: d.urgency||'repair_soon',
                        estimatedRepairCost: d.estimatedRepairCost||{min:0,max:0,currency:'USD'}
              })),
              overallCondition: ['excellent','good','fair','poor','critical'].includes(p.overallCondition)?p.overallCondition:'fair',
              summary: p.summary||'Inspection complete.',
              totalEstimatedCost: p.totalEstimatedCost||{min:0,max:0,currency:'USD'},
              inspectionType: p.inspectionType||'other',
              imageQuality: p.imageQuality||'fair',
              surfaceDescription: p.surfaceDescription||'',
              conditionRationale: p.conditionRationale||'',
              priorityAction: p.priorityAction||'',
              professionalInspectionNeeded: !!p.professionalInspectionNeeded,
              disclaimer: p.disclaimer||''
      };
}

app.post('/analyze', async (req, res) => {
      if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });
      const { imageBase64, mediaType = 'image/jpeg' } = req.body;
      if (!imageBase64 || imageBase64.length < 100) return res.status(400).json({ error: 'Valid imageBase64 required' });

           const msgs = [{ role: 'user', content: [
               { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
               { type: 'text', text: getPrompt() }
                 ]}];

           try {
                   // PRIMARY: Extended thinking - deep reasoning reduces hallucination ~50% per research
        let r = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-beta':'interleaved-thinking-2025-05-14' },
                  body: JSON.stringify({ model:'claude-opus-4-6', max_tokens:10000, temperature:1, thinking:{type:'enabled',budget_tokens:5000}, system:SYSTEM, messages:msgs })
        });

        // FALLBACK: Standard mode with temperature=0 (most accurate without thinking)
        if (!r.ok && r.status === 400) {
                  r = await fetch('https://api.anthropic.com/v1/messages', {
                              method: 'POST',
                              headers: { 'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01' },
                              body: JSON.stringify({ model:'claude-opus-4-6', max_tokens:3000, temperature:0, system:SYSTEM, messages:msgs })
                  });
        }

        if (!r.ok) return res.status(r.status).json({ error: await r.text() });

        const data = await r.json();
                   const textBlock = data.content?.find(b => b.type === 'text');
                   if (!textBlock) return res.status(500).json({ error: 'No response from AI' });

        res.json(normalize(parseJSON(textBlock.text)));
           } catch(e) {
                   res.status(500).json({ error: e.message||'Analysis failed' });
           }
});

app.listen(PORT, () => console.log('SnapInspect AI v2.0 on port ' + PORT));
