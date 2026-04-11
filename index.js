const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
app.get('/', (req, res) => res.json({ status: 'SnapInspect AI server running' }));
app.post('/analyze', async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });
    const { imageBase64, mediaType = 'image/jpeg' } = req.body;
      if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });
        const PROMPT = 'You are an expert damage inspector. Analyze this image and return ONLY valid JSON with no markdown: {"defects":[{"id":"1","type":"crack","severity":"high","location":"wall","description":"desc","estimatedRepairCost":{"min":200,"max":500,"currency":"USD"}}],"overallCondition":"poor","summary":"assessment","totalEstimatedCost":{"min":500,"max":1200,"currency":"USD"},"inspectionType":"property"}. severity=low/medium/high/critical, overallCondition=excellent/good/fair/poor/critical, inspectionType=property/vehicle/structural/roof/floor/other';
          try {
              const r = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                                body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 1500, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } }, { type: 'text', text: PROMPT }] }] })
                                    });
                                        if (!r.ok) return res.status(r.status).json({ error: await r.text() });
                                            const d = await r.json();
                                                const t = (d.content?.find(b => b.type === 'text')?.text || '').replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
                                                    res.json(JSON.parse(t));
                                                      } catch(e) { res.status(500).json({ error: e.message }); }
                                                      });
                                                      app.listen(PORT, () => console.log('Server on port ' + PORT));
