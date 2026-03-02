module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('');

  try {
    const response = await fetch('https://cloud.umami.is/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': req.headers['user-agent'] || '',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.text();
    res.status(response.status).send(data);
  } catch {
    res.status(502).send('');
  }
};
