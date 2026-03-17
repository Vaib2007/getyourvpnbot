const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = 'YOUR_BOT_TOKEN';
const WEBHOOK_URL = 'https://your-domain.com/webhook';
const DATA_DIR = './surfshark_data/';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const bot = new TelegramBot(TOKEN, { webhook: { hook: WEBHOOK_URL } });

function generateWireguardKeys(userId) {
  const userDir = path.join(DATA_DIR, String(userId));
  
  try {
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    
    const pubKeyBase64 = crypto.createPublicKey(publicKey)
      .export({ type: 'spki', format: 'der' })
      .slice(-32)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    const privKeyBase64 = crypto.createPrivateKey(privateKey)
      .export({ type: 'pkcs8', format: 'der' })
      .slice(-32)
      .toString('base64');
    
    return { privateKey: privKeyBase64, publicKey: pubKeyBase64, userDir };
  } catch (e) {
    console.error('Key generation failed:', e);
    return null;
  }
}

async function surfsharkLogin(email, password) {
  try {
    const response = await axios.post('https://api.surfshark.com/v1/auth/login', 
      { username: email, password: password },
      { headers: { 'Content-Type': 'application/json;charset=utf-8' } }
    );
    return response.data;
  } catch (e) {
    console.error('Login error:', e.message);
    return null;
  }
}

async function getSubscriptionInfo(token) {
  try {
    const response = await axios.get('https://api.surfshark.com/v1/payment/subscriptions/current', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data;
  } catch (e) {
    return null;
  }
}

async function registerWireguard(token, publicKey) {
  try {
    const response = await axios.post('https://api.surfshark.com/v1/account/users/public-keys',
      { pubKey: publicKey },
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return response.data;
  } catch (e) {
    return null;
  }
}

async function getServerList() {
  try {
    const response = await axios.get('https://api.surfshark.com/v4/server/clusters/generic', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const servers = response.data;
    const unique = new Map();
    for (const server of servers) {
      const loc = server.location || 'unknown';
      if (!unique.has(loc)) unique.set(loc, server);
    }
    return Array.from(unique.values());
  } catch (e) {
    return [];
  }
}

function generateConfig(privateKey, server) {
  return `[Interface]
PrivateKey = ${privateKey}
Address = 10.14.0.2/16
DNS = 162.252.172.57, 149.154.159.92

[Peer]
PublicKey = ${server.pubKey}
AllowedIps = 0.0.0.0/0
Endpoint = ${server.connectionName}:51820
PersistentKeepalive = 25`;
}

bot.on('message', async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  
  if (!text || !userId) return;
  
  if (text.startsWith('/connect ')) {
    const creds = text.slice(9).split(':');
    if (creds.length < 2) {
      await bot.sendMessage(chatId, '❌ Wrong format!\n\nUse: /connect email:password');
      return;
    }
    
    const email = creds[0];
    const password = creds.slice(1).join(':');
    
    await bot.sendMessage(chatId, '🔐 Logging into Surfshark...');
    
    const loginResult = await surfsharkLogin(email, password);
    if (!loginResult) {
      await bot.sendMessage(chatId, '❌ Login failed! Check credentials.');
      return;
    }
    
    const token = loginResult.token;
    if (!token) {
      await bot.sendMessage(chatId, '❌ Invalid response.');
      return;
    }
    
    await bot.sendMessage(chatId, '✅ Logged in! Getting subscription...');
    
    const subInfo = await getSubscriptionInfo(token);
    if (subInfo) {
      await bot.sendMessage(chatId, `📋 Plan: ${subInfo.name}\nExpires: ${subInfo.expiresAt}`);
    }
    
    await bot.sendMessage(chatId, '🔑 Generating WireGuard keys...');
    
    const keys = generateWireguardKeys(userId);
    if (!keys) {
      await bot.sendMessage(chatId, '❌ Failed to generate keys.');
      return;
    }
    
    await bot.sendMessage(chatId, '📝 Registering public key...');
    
    const regResult = await registerWireguard(token, keys.publicKey);
    if (!regResult) {
      await bot.sendMessage(chatId, '❌ Failed to register key. Max devices reached?');
      return;
    }
    
    const expires = regResult.expiresAt || 'Unknown';
    await bot.sendMessage(chatId, `✅ Key registered! Valid until: ${expires}`);
    
    await bot.sendMessage(chatId, '🌍 Fetching servers...');
    
    const servers = await getServerList();
    if (!servers.length) {
      await bot.sendMessage(chatId, '❌ Could not fetch servers.');
      return;
    }
    
    await bot.sendMessage(chatId, `📦 Generating configs for ${servers.length} servers...`);
    
    let count = 0;
    for (const server of servers) {
      try {
        const config = generateConfig(keys.privateKey, server);
        const location = (server.location || 'unknown').replace(/ /g, '_');
        const filePath = path.join(keys.userDir, `${location}.conf`);
        fs.writeFileSync(filePath, config);
        count++;
      } catch (e) {
        console.error('Config error:', e.message);
      }
    }
    
    if (count === 0) {
      await bot.sendMessage(chatId, '❌ No configs generated.');
      return;
    }
    
    const firstFile = path.join(keys.userDir, fs.readdirSync(keys.userDir)[0]);
    
    await bot.sendMessage(chatId, `✅ ${count} configs generated!\n📤 Sending file...`);
    
    await bot.sendDocument(chatId, firstFile, {
      caption: `🎉 Here's your WireGuard config!\n\n${count} servers available.`,
    });
    
    await bot.sendMessage(chatId, '📌 How to use:\n1. Install WireGuard app\n2. Import .conf file\n3. Connect!');
  }
  else if (text === '/start') {
    await bot.sendMessage(chatId, '🌊 Surfshark VPN Bot\n\n/connect email:password - Generate configs');
  }
  else if (text === '/help') {
    await bot.sendMessage(chatId, 'Use: /connect email:password\nExample:\n/connect john@example.com:MyPassword123');
  }
});

console.log('Bot started...');
