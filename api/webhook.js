const bot = require('../index');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.processUpdate(req.body);
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ ok: false });
    }
  } else {
    res.status(200).json({ ok: true });
  }
};
