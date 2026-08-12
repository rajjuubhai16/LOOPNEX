// --- Backend API Discovery & Safe Communication Layer ---
let detectedBackendUrl = null;

async function getBackendUrl() {
  if (detectedBackendUrl !== null) {
    return detectedBackendUrl;
  }

  // AGAR WEBSITE GITHUB PAGES YA LIVE DOMAIN PAR HAI, TOH SEEDHA RENDER BACKEND USE KRO:
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.hostname !== '') {
    detectedBackendUrl = 'https://loopnex-backend.onrender.com';
    return detectedBackendUrl;
  }

  // Local testing ke liye:
  const currentOrigin = window.location.origin && window.location.origin !== 'null' ? window.location.origin : '';
  const candidateOrigins = [];

  if (currentOrigin && !currentOrigin.startsWith('file:')) {
    candidateOrigins.push(currentOrigin);
  }
  
  ['http://localhost:5500', 'http://localhost:5501', 'http://127.0.0.1:5500', 'http://127.0.0.1:5501', 'http://localhost:3000'].forEach(url => {
    if (!candidateOrigins.includes(url)) {
      candidateOrigins.push(url);
    }
  });

  for (const origin of candidateOrigins) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${origin}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        if (text && text.includes('"status"') && text.includes('"ok"')) {
          detectedBackendUrl = origin === currentOrigin ? '' : origin;
          return detectedBackendUrl;
        }
      }
    } catch (_) {}
  }

  detectedBackendUrl = 'https://loopnex-backend.onrender.com';
  return detectedBackendUrl;
}