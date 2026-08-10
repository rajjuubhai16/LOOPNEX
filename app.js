lucide.createIcons();

// --- Backend API Discovery & Safe Communication Layer ---
let detectedBackendUrl = null;

/**
 * Discovers the active Express backend URL across common local ports
 * (Handles port collisions when VS Code Live Server is running on port 5500)
 */
async function getBackendUrl() {
  if (detectedBackendUrl !== null) {
    return detectedBackendUrl;
  }

  // If running on http/https, default candidate is same-origin
  const currentOrigin = window.location.origin && window.location.origin !== 'null' ? window.location.origin : '';
  const candidateOrigins = [];

  if (currentOrigin && !currentOrigin.startsWith('file:')) {
    candidateOrigins.push(currentOrigin);
  }
  // Common ports where server.js might be running
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
    } catch (_) {
      // Continue to test next candidate origin
    }
  }

  detectedBackendUrl = '';
  return detectedBackendUrl;
}

/**
 * Safely executes a fetch request and parses JSON
 * Guarantees NO "Failed to execute 'json' on 'Response': Unexpected end of JSON input" errors
 */
async function safeFetchJson(endpoint, options = {}) {
  const backendBase = await getBackendUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const fullUrl = backendBase ? `${backendBase}${cleanEndpoint}` : cleanEndpoint;

  try {
    const response = await fetch(fullUrl, options);
    
    // Read raw text first to avoid parser crash on empty (0 bytes) or HTML response
    const rawText = await response.text();
    let jsonData = null;
    let isJson = false;

    if (rawText && rawText.trim().length > 0) {
      try {
        jsonData = JSON.parse(rawText);
        isJson = true;
      } catch (parseErr) {
        console.warn(`Response from ${fullUrl} was not valid JSON:`, rawText.slice(0, 120));
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: jsonData || {},
      isJson,
      rawText: rawText || '',
      error: null
    };
  } catch (networkError) {
    console.warn(`Network communication to ${fullUrl} failed:`, networkError.message);
    return {
      ok: false,
      status: 0,
      data: {},
      isJson: false,
      rawText: '',
      error: networkError.message || 'Connection failed'
    };
  }
}

// --- App Initialization on DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Fetch Backend Config & Data Safely
  try {
    const result = await safeFetchJson('/api/config');
    if (result.ok && result.data) {
      const data = result.data;

      // Dashboard Video
      const dashSrc = document.getElementById('dash-video-src');
      if (dashSrc && data.dashboardVideo) {
        dashSrc.src = data.dashboardVideo;
        dashSrc.parentElement.load();
      }

      // Home Video
      const homeSrc = document.getElementById('home-video-src');
      if (homeSrc && data.homeVideo) {
        homeSrc.src = data.homeVideo;
        homeSrc.parentElement.load();
      }

      // Social Links
      if (document.getElementById('linkedin-btn') && data.linkedin) document.getElementById('linkedin-btn').href = data.linkedin;
      if (document.getElementById('whatsapp-btn') && data.whatsappChat) document.getElementById('whatsapp-btn').href = data.whatsappChat;
      if (document.getElementById('twitter-btn') && data.twitter) document.getElementById('twitter-btn').href = data.twitter;
      if (document.getElementById('instagram-btn') && data.instagram) document.getElementById('instagram-btn').href = data.instagram;
      if (document.getElementById('threads-btn') && data.threads) document.getElementById('threads-btn').href = data.threads;

      // WhatsApp Text & Link
      const waTextLink = document.getElementById('whatsapp-text-link');
      if (waTextLink && data.whatsappChat) {
        waTextLink.href = data.whatsappChat;
        waTextLink.textContent = data.whatsappNumber ? `+${data.whatsappNumber}` : '+91 6386449592';
      }

      // Email Text & Link
      const emailLink = document.getElementById('email-link');
      if (emailLink && data.email) {
        emailLink.href = `mailto:${data.email}`;
        emailLink.textContent = data.email;
      }
    }
  } catch (error) {
    console.warn('Backend configuration notice:', error.message);
  }

  // 2. User Login / Page Visibility Logic
  const savedEmail = localStorage.getItem('user_email');
  if (savedEmail) {
    const displayEl = document.getElementById('saved-email-display');
    if (displayEl) displayEl.innerText = savedEmail;
    switchPage('home');
  } else {
    switchPage('dashboard');
  }
});

// Helper: Strict Email Regex Validation
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}

// --- Login Handler ---
async function handleLogin(event) {
  event.preventDefault();
  const inputEl = document.getElementById('user-email-input');
  const errorEl = document.getElementById('login-error-msg');
  if (!inputEl) return;

  const emailInput = inputEl.value.trim();

  // Strict email format check
  if (!emailInput || !isValidEmail(emailInput)) {
    if (errorEl) {
      errorEl.textContent = '❌ Kripya valid email address daalein (e.g. name@gmail.com)';
      errorEl.classList.remove('hidden');
    }
    inputEl.focus();
    return;
  }

  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }

  const submitBtn = event.target.querySelector('button[type="submit"]');
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