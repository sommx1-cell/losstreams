const express = require('express');
const http = require('http');
const https = require('https');
const url = require('url');

const app = express();

// CORS
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  next();
});

app.options('*', (req, res) => res.sendStatus(200));

function fetchUrl(targetUrl, res, proxyBase, originalReq, redirectCount = 0) {
  if (redirectCount > 5) {
    return res.status(500).send('Demasiadas redirecciones');
  }

  const parsed = url.parse(targetUrl);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path || '/',
    method: 'GET',
    timeout: 15000,
    headers: {
      'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'Icy-MetaData': '1'
    }
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    const status = proxyRes.statusCode;

    // Seguir redirecciones 301/302/303/307/308
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = proxyRes.headers['location'];
      if (!location) return res.status(500).send('Redireccion sin Location');
      const newUrl = location.startsWith('http') ? location : url.resolve(targetUrl, location);
      console.log(`Redireccion ${status} -> ${newUrl}`);
      proxyRes.resume();
      return fetchUrl(newUrl, res, proxyBase, originalReq, redirectCount + 1);
    }

    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';

    // Si es m3u8, reescribir URLs internas
    const isM3u8 = targetUrl.match(/\.m3u8/i) || contentType.includes('mpegurl');
    if (isM3u8) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Access-Control-Allow-Origin', '*');
      let body = '';
      proxyRes.on('data', chunk => body += chunk.toString());
      proxyRes.on('end', () => {
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        const rewritten = body.split('\n').map(line => {
          line = line.trim();
          if (!line || line.startsWith('#')) return line;
          if (line.startsWith('http')) return proxyBase + encodeURIComponent(line);
          return proxyBase + encodeURIComponent(baseUrl + line);
        }).join('\n');
        res.send(rewritten);
      });
    } else {
      // Stream directo (ts, mp4, etc)
      res.set('Content-Type', contentType);
      res.set('Access-Control-Allow-Origin', '*');
      if (proxyRes.headers['content-length']) {
        res.set('Content-Length', proxyRes.headers['content-length']);
      }
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).send('Timeout conectando al stream');
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(500).send('Error: ' + err.message);
  });

  proxyReq.end();
}

app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Falta ?url=');
  const proxyBase = req.protocol + '://' + req.get('host') + '/proxy?url=';
  fetchUrl(targetUrl, res, proxyBase, req);
});

app.get('/', (req, res) => {
  res.send('LosStreams Proxy activo. Uso: /proxy?url=TU_LINK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Proxy corriendo en puerto', PORT));
