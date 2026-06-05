const express = require('express');
const http = require('http');
const https = require('https');
const url = require('url');

const app = express();

// CORS
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  next();
});

app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Falta ?url=');

  const parsed = url.parse(targetUrl);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; IPTV)',
      'Accept': '*/*'
    }
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');

    // Si es m3u8, reescribir URLs internas
    if (targetUrl.match(/\.m3u8/i) || contentType.includes('mpegurl')) {
      let body = '';
      proxyRes.on('data', chunk => body += chunk.toString());
      proxyRes.on('end', () => {
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        const proxyBase = req.protocol + '://' + req.get('host') + '/proxy?url=';
        const rewritten = body.split('\n').map(line => {
          line = line.trim();
          if (!line || line.startsWith('#')) return line;
          if (line.startsWith('http')) return proxyBase + encodeURIComponent(line);
          return proxyBase + encodeURIComponent(baseUrl + line);
        }).join('\n');
        res.send(rewritten);
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(500).send('Error: ' + err.message);
  });

  proxyReq.end();
});

app.get('/', (req, res) => {
  res.send('LosStreams Proxy activo. Uso: /proxy?url=TU_LINK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Proxy corriendo en puerto', PORT));
