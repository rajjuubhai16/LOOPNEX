// ==========================================
// Loopnex Frontend Controller & Backend Integration
// ==========================================

let detectedBackendUrl = null;

// --- Backend API Discovery & Safe Communication Layer ---
async function getBackendUrl() {
  if (detectedBackendUrl !== null) {
    return detectedBackendUrl;
  }

  // Live deployment check: If hosted on GitHub Pages or custom domain, fallback to Render backend
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.hostname !== '') {
    detectedBackendUrl = 'https://loopnex-backend.onrender.com';
    return detectedBackendUrl;
  }

  // Local testing discovery
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

  // Fallback to relative path or Render
  detectedBackendUrl = currentOrigin && !currentOrigin.startsWith('file:') ? '' : 'https://loopnex-backend.onrender.com';
  return detectedBackendUrl;
}

// Safe Fetch Helper with JSON parsing and error handling
async function safeFetchJson(endpoint, options = {}) {
  try {
    const baseUrl = await getBackendUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = baseUrl ? `${baseUrl}${cleanEndpoint}` : cleanEndpoint;

    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (isJson) {
      const data = await response.json();
      return { ok: response.ok, status: response.status, data, isJson: true };
    } else {
      const text = await response.text();
      return { ok: response.ok, status: response.status, text, isJson: false };
    }
  } catch (error) {
    return { ok: false, status: 0, error: error.message, isJson: false };
  }
}

// Strict email validation helper for frontend
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleaned = email.trim();
  if (cleaned.length < 5 || cleaned.length > 254) return false;
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(cleaned);
}

// --- Dynamic Config Fetcher from Backend ---
async function loadDynamicConfig() {
  try {
    const result = await safeFetchJson('/api/config');
    if (result.ok && result.data) {
      const config = result.data;
      if (config.whatsappChat) {
        document.querySelectorAll('a[title="WhatsApp"]').forEach(el => el.href = config.whatsappChat);
      }
      if (config.linkedin) {
        document.querySelectorAll('a[title="LinkedIn"]').forEach(el => el.href = config.linkedin);
      }
      if (config.twitter) {
        document.querySelectorAll('a[title="Twitter"]').forEach(el => el.href = config.twitter);
      }
      if (config.instagram) {
        document.querySelectorAll('a[title="Instagram"]').forEach(el => el.href = config.instagram);
      }
      if (config.threads) {
        document.querySelectorAll('a[title="Threads"]').forEach(el => el.href = config.threads);
      }
    }
  } catch (e) {
    console.warn('Could not load dynamic config from backend:', e);
  }
}

// --- Login / Sign Up Screen Handler ---
async function handleLogin(event) {
  event.preventDefault();
  const inputEl = document.getElementById('user-email-input');
  const errorEl = document.getElementById('login-error-msg');
  const submitBtn = event.target ? event.target.querySelector('button[type="submit"]') : null;

  if (!inputEl) return;
  const emailInput = inputEl.value.trim().toLowerCase();

  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }

  if (!isValidEmail(emailInput)) {
    if (errorEl) {
      errorEl.textContent = '❌ Please enter a valid email address (e.g. name@gmail.com)';
      errorEl.classList.remove('hidden');
    }
    inputEl.focus();
    return;
  }

  const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Sign In / Sign Up →';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Connecting securely... 🚀';
  }

  // Trigger Backend Mail Alert & Check Rate Limits
  try {
    const result = await safeFetchJson('/api/send-login-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput })
    });

    if (result.status === 429) {
      if (errorEl) {
        errorEl.textContent = `⏳ ${result.data.error || 'Too many attempts. Please wait.'}`;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (!result.ok && result.data && result.data.error) {
      if (errorEl) {
        errorEl.textContent = `❌ ${result.data.error}`;
        errorEl.classList.remove('hidden');
      }
      return;
    }
  } catch (err) {
    console.warn('Login alert background notification notice:', err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }

  localStorage.setItem('user_email', emailInput);
  const displayEl = document.getElementById('saved-email-display');
  if (displayEl) displayEl.innerText = emailInput;
  switchPage('home');
}

function handleLogout() {
  localStorage.removeItem('user_email');
  switchPage('dashboard');
}

// --- Enquiry / Reach Us Form Handler ---
async function handleEnquiryForm(event) {
  event.preventDefault();

  const nameEl = document.getElementById('enquiry-name');
  const emailEl = document.getElementById('enquiry-email');
  const serviceEl = document.getElementById('enquiry-service');
  const msgEl = document.getElementById('enquiry-message');
  const statusMsg = document.getElementById('form-status-msg');
  const form = document.getElementById('reach-us-form');

  const name = nameEl ? nameEl.value.trim() : '';
  const email = emailEl ? emailEl.value.trim() : '';
  const service = serviceEl ? serviceEl.value : '';
  const message = msgEl ? msgEl.value.trim() : '';

  if (!name || !email || !service || !message) {
    if (statusMsg) {
      statusMsg.className = 'text-xs text-red-600 font-semibold';
      statusMsg.textContent = '⚠️ Please fill out all fields before sending.';
    }
    return;
  }

  if (!isValidEmail(email)) {
    if (statusMsg) {
      statusMsg.className = 'text-xs text-red-600 font-semibold';
      statusMsg.textContent = '❌ Please enter a valid email address (e.g. you@example.com).';
    }
    if (emailEl) emailEl.focus();
    return;
  }

  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  const originalBtnContent = submitBtn ? submitBtn.innerHTML : 'Send message';

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Sending message... ⏳';
  }

  if (statusMsg) {
    statusMsg.className = 'text-xs text-sky-700 font-medium animate-pulse';
    statusMsg.textContent = 'Sending your message to Loopnex...';
  }

  try {
    const result = await safeFetchJson('/api/send-enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, service, message })
    });

    if (result.status === 429) {
      throw new Error(result.data.error || 'Too many submissions. Please wait a few minutes before trying again.');
    }

    if (result.ok && result.data && result.data.success) {
      if (statusMsg) {
        statusMsg.className = 'text-xs text-emerald-600 font-semibold';
        statusMsg.textContent = '✅ Message sent successfully! We will get back to you within 24 hours.';
      }
      if (form) form.reset();
    } else {
      // Check if server is offline or returned error
      if (result.status === 0 || !result.isJson) {
        throw new Error('Backend server is not reachable. Please make sure the server is running (npm start) or contact us via WhatsApp.');
      } else {
        throw new Error(result.data.error || 'Failed to send message. Please try again.');
      }
    }
  } catch (error) {
    console.error('Enquiry submission error:', error);
    if (statusMsg) {
      statusMsg.className = 'text-xs text-red-600 font-semibold';
      statusMsg.textContent = `❌ ${error.message || 'Error sending message. Please contact us via WhatsApp.'}`;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnContent;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// --- Copy Coupon Code Handler ---
function copyCouponCode() {
  const couponEl = document.getElementById('coupon-code');
  const statusEl = document.getElementById('copy-status');
  if (!couponEl) return;

  const code = couponEl.textContent.trim();
  navigator.clipboard.writeText(code).then(() => {
    if (statusEl) {
      statusEl.textContent = '✓ Copied to clipboard!';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 3500);
    }
  }).catch(() => {
    if (statusEl) {
      statusEl.textContent = `Code: ${code}`;
    }
  });
}

// --- Page Navigation ---
function switchPage(pageId) {
  const pages = document.querySelectorAll('.page-section');
  pages.forEach(el => el.classList.remove('active-page'));

  const targetPage = document.getElementById('page-' + pageId);
  if (targetPage) targetPage.classList.add('active-page');

  window.scrollTo(0, 0);

  const header = document.getElementById('main-header');
  const footer = document.getElementById('main-footer');

  if (pageId === 'dashboard' || pageId === 'home') {
    if (footer) footer.classList.add('hidden');
  } else {
    if (footer) footer.classList.remove('hidden');
  }

  if (pageId === 'dashboard') {
    if (header) header.classList.add('hidden');
  } else {
    if (header) header.classList.remove('hidden');
  }

  if (window.lucide) lucide.createIcons();
}

// --- Modal Handling for Studio Services ---
function openModal(serviceType) {
  const modal = document.getElementById('detail-modal');
  const titleEl = document.getElementById('modal-title');
  const descEl = document.getElementById('modal-desc');
  const numEl = document.getElementById('modal-num');
  const btnText = document.getElementById('modal-btn-text');
  const listEl = document.getElementById('modal-list');

  if (!modal) return;

  const servicesData = {
    'smart-website': {
      num: '01',
      title: 'Smart Website',
      desc: 'Next-gen intelligent websites engineered with high-converting AI layouts, instant smart search, and personalized visitor journeys.',
      items: ['AI-powered layout optimization', 'Instant lightning-fast search', 'Personalized user conversion paths', 'Mobile-first responsive architecture']
    },
    'meta-ads': {
      num: '02',
      title: 'Meta Ads',
      desc: 'High-ROAS paid campaign management on Facebook & Instagram to print high-intent leads and direct sales for your brand.',
      items: ['Advanced audience segmentation', 'High-converting creative strategy', 'Continuous A/B split testing', 'Real-time ROAS tracking & scaling']
    },
    'ai-chatbot': {
      num: '03',
      title: 'AI Chatbot',
      desc: '24/7 autonomous digital assistants that engage website visitors, qualify leads, answer queries, and schedule appointments instantly.',
      items: ['Instant 24/7 customer engagement', 'Automated lead qualification workflow', 'Direct calendar appointment booking', 'Seamless CRM data synchronization']
    },
    'ai-loop': {
      num: '04',
      title: 'AI Loop',
      desc: 'End-to-end automated growth loops connecting your marketing, sales, CRM, and customer follow-ups without manual repetitive work.',
      items: ['Unified marketing-to-sales automation', 'Automated multi-channel follow-ups', 'CRM pipeline synchronization', 'Zero manual repetitive data entry']
    }
  };

  const data = servicesData[serviceType];
  if (data) {
    if (numEl) numEl.textContent = data.num;
    if (titleEl) titleEl.textContent = data.title;
    if (descEl) descEl.textContent = data.desc;
    if (btnText) btnText.textContent = data.title;
    if (listEl) {
      listEl.innerHTML = data.items.map(item => `<li>✦ ${item}</li>`).join('');
    }
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (window.lucide) lucide.createIcons();
}

function closeModal() {
  const modal = document.getElementById('detail-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

// --- App Initialization on DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // Load server config dynamically (WhatsApp links, email etc.)
  loadDynamicConfig();

  // Check persisted login
  const savedUser = localStorage.getItem('user_email');
  if (savedUser) {
    const displayEl = document.getElementById('saved-email-display');
    if (displayEl) displayEl.innerText = savedUser;
    switchPage('home');
  } else {
    switchPage('dashboard');
  }
});