require('dns').setServers(['8.8.8.8', '1.1.1.1']);

const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/data/facts.json', (_req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'facts.json'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
