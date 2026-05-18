// Sweep stale QA-test members across every project the PM can see.
const ROOT = 'https://neoleadge.pythagore-init.com';

async function loginPm() {
  const r = await fetch(`${ROOT}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pm@neoleadge.com', password: 'Pm@123' }),
  });
  return (await r.json()).jwt;
}

const jwt = await loginPm();
const auth = { Authorization: `Bearer ${jwt}` };

const projRes = await fetch(`${ROOT}/pm/projects`, { headers: auth });
const projData = await projRes.json();
const projects = Array.isArray(projData) ? projData : (projData.items ?? []);

let removed = 0;
for (const p of projects) {
  const mRes = await fetch(`${ROOT}/pm/projects/${p.id}/members`, { headers: auth });
  if (!mRes.ok) continue;
  const mData = await mRes.json();
  const members = Array.isArray(mData) ? mData : (mData.members ?? []);
  for (const m of members) {
    if (typeof m.label === 'string' && /qa-/i.test(m.label)) {
      await fetch(`${ROOT}/pm/projects/${p.id}/members/${m.id}?force=true`, {
        method: 'DELETE',
        headers: auth,
      });
      console.log(`removed QA member from project ${p.name ?? p.id}: ${m.label}`);
      removed++;
    }
  }
}
console.log(`Done — ${removed} QA member(s) removed.`);
