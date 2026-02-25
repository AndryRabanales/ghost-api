const API = 'https://ghost-api-production.up.railway.app';
fetch(API + '/c9f42720-771e-4b61-aeb9-42b9d5f5aca4/c31d497a-f1d7-41f4-a4ca-4a1ca51b0d77/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Test message here' })
})
    .then(r => r.json())
    .then(console.log)
    .catch(console.error);
