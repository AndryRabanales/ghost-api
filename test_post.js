const API = 'http://localhost:8080';
fetch(API + '/some-token/some-chat-id/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Test message' })
})
    .then(r => r.json())
    .then(console.log)
    .catch(console.error);
