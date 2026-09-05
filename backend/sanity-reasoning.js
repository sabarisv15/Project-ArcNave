const config = require('./src/config');
const { GoogleAuth } = require('google-auth-library');
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

async function raw(model) {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const url = `https://aiplatform.googleapis.com/v1/projects/${config.gemini.projectId}/locations/global/endpoints/openapi/chat/completions`;
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are ARCNAVE, a campus assistant. Use the attendance_summary tool for attendance questions.',
      },
      { role: 'user', content: '3rd Sem CSE-A attendance percentage enna?' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'attendance_summary',
          description: 'Attendance rate per class within scope.',
          parameters: { type: 'object', properties: { classId: { type: 'string' } } },
        },
      },
    ],
    tool_choice: 'auto',
    max_tokens: 1024,
    temperature: 0.2,
  };
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - start;
  const json = await res.json();
  const msg = json.choices ? json.choices[0].message : json;
  console.log(
    `--- model=${model} status=${res.status} latencyMs=${latency} finish_reason=${json.choices && json.choices[0].finish_reason} ---`,
  );
  console.log('tool_calls:', JSON.stringify(msg && msg.tool_calls));
  console.log('content (first 300 chars):', msg && msg.content ? msg.content.slice(0, 300) : msg && msg.content);
  console.log('usage:', JSON.stringify(json.usage));
  if (!res.ok) console.log('error body:', JSON.stringify(json).slice(0, 500));
}
async function main() {
  await raw('zai-org/glm-5.2-maas');
  await raw('moonshotai/kimi-k2-thinking-maas');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
