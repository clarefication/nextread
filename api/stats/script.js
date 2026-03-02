module.exports = async function handler(req, res) {
  try {
    const response = await fetch('https://cloud.umami.is/script.js');
    const script = await response.text();
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(script);
  } catch {
    res.status(502).send('');
  }
};
