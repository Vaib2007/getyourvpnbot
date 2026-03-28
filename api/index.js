const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  try {
    const htmlPath = path.join(process.cwd(), 'public', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (error) {
    console.error('Error serving index:', error);
    res.status(500).json({ error: 'Failed to load page' });
  }
};
