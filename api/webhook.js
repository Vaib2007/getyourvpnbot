const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN || '8505390968:AAHFnruoXTNHdX-iYXN1NNJk94rMMS_sCIg';
const DATA_DIR = '/tmp/surfshark_data/';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const bot = new TelegramBot(TOKEN, { polling: false });

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, status: 'Bot running' });
  }

  try {
    const update = req.body;
    const msg = update.message;
    
    if (!msg || !msg.text) {
      return res.status(200).json({ ok: true });
    }

    const text = msg.text;
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (text === '/start') {
      await bot.sendMessage(chatId, '🌊 Surfshark VPN Bot\n\n/connect email:password - Generate configs\n/help - Help');
    }
    else if (text === '/help') {
      await bot.sendMessage(chatId, 'Use: /connect email:password\n\nExample:\n/connect john@example.com:MyPassword123');
    }
    else if (text.startsWith('/connect ')) {
      const creds = text.slice(9);
      const colonIndex = creds.indexOf(':');
      if (colonIndex === -1) {
        await bot.sendMessage(chatId, '❌ Wrong format!\n\nUse: /connect email:password');
        return res.status(200).json({ ok: true });
      }

      const email = creds.slice(0, colonIndex);
      const password = creds.slice(colonIndex + 1);

      await bot.sendMessage(chatId, '🔐 Logging into Surfshark...');

      try {
await new Promise(resolve => setTimeout(resolve, 2000));
const loginRes = await axios.post('https://my.uymgg1.com/auth/login',
  { username: email, password },
  { headers: { 
    'Content-Type': 'application/json;charset=utf-8',
    'User-Agent': 'Surfshark/2.24.0 (com.surfshark.vpnclient.ios; build:19; iOS 14.8.1) Alamofire/5.4.3 device/mobile',
    'Accept': 'application/json',
    'Accept-Language': 'en-US;q=1.0',
    'Accept-Encoding': 'gzip, deflate'
  } }
);
        const token = loginRes.data?.token;
        if (!token) {
          await bot.sendMessage(chatId, '❌ Login failed!');
          return res.status(200).json({ ok: true });
        }

        await bot.sendMessage(chatId, '✅ Logged in!\n🔑 Generating WireGuard keys...');

        const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519', {
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });

        const pubKeyBase64 = crypto.createPublicKey(publicKey)
          .export({ type: 'spki', format: 'der' })
          .slice(-32).toString('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

        const privKeyBase64 = crypto.createPrivateKey(privateKey)
          .export({ type: 'pkcs8', format: 'der' })
          .slice(-32).toString('base64');

        await bot.sendMessage(chatId, '📝 Registering key with Surfshark...');

        await axios.post('https://api.surfshark.com/v1/account/users/public-keys',
          { pubKey: pubKeyBase64 },
          { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );

        await bot.sendMessage(chatId, '🌍 Fetching servers...');

        const serversRes = await axios.get('https://api.surfshark.com/v4/server/clusters/generic');
        const servers = serversRes.data;

        const unique = new Map();
        for (const s of servers) {
          if (!unique.has(s.location)) unique.set(s.location, s);
        }
        const uniqueServers = Array.from(unique.values());

        const userDir = path.join(DATA_DIR, String(userId));
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

        let count = 0;
        for (const server of uniqueServers) {
          try {
            const config = `[Interface]\nPrivateKey = ${privKeyBase64}\nAddress = 10.14.0.2/16\nDNS = 162.252.172.57\n\n[Peer]\nPublicKey = ${server.pubKey}\nAllowedIps = 0.0.0.0/0\nEndpoint = ${server.connectionName}:51820\nPersistentKeepalive = 25`;
            const loc = (server.location || 'unknown').replace(/ /g, '_');
            fs.writeFileSync(path.join(userDir, `${loc}.conf`), config);
            count++;
          } catch {}
        }

        const firstConf = path.join(userDir, fs.readdirSync(userDir)[0]);
        await bot.sendMessage(chatId, `✅ ${count} configs ready!\n📤 Sending...`);
        await bot.sendDocument(chatId, firstConf, {
          caption: `🎉 WireGuard config\n\n📌 Import in WireGuard app to connect!`
        });

      } catch (err) {
        console.error(err.message);
        await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ ok: true });
  }
};
