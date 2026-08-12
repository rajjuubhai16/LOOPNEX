require('dotenv').config();
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5500;

// Enable Trust Proxy for accurate IP rate limiting on Render / Cloud proxies
app.set('trust proxy', 1);

// Enable CORS for all origins and methods
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Middleware to safely handle invalid JSON payloads
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON payload received.' });
  }
  next(err);
});

app.use(express.static(__dirname));

const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS ? process.env.EMAIL_PASS.trim() : '';

// Nodemailer SMTP Transporter
let transporter = null;
if (emailUser && emailPass) {
  try {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: emailUser,
        pass: emailPass
      },
      family: 4,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000
    });

    transporter.verify((error) => {
      if (error) {
        console.warn('⚠️ SMTP Verify Notice (Expected on cloud free tiers like Render that block port 465/587):', error.message);
      } else {
        console.log('✅ Gmail SMTP Server is connected and ready');
      }
    });
  } catch (e) {
    console.warn('⚠️ Could not initialize Nodemailer transporter:', e.message);
  }
}

// Unified Cloud-Safe Email Dispatcher (HTTPS REST API & SMTP fallback)
async function sendEmailNotification({ to, replyTo, subject, text, html, fromName = 'Loopnex' }) {
  // 1. Resend API (Recommended for Render Free Tier - communicates via HTTPS port 443)
  if (process.env.RESEND_API_KEY) {
    try {
      const fromAddr = process.env.RESEND_FROM || `${fromName} <onboarding@resend.dev>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddr,
          to: Array.isArray(to) ? to : [to],
          reply_to: replyTo,
          subject,
          text,
          html
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Resend delivery rejected');
      console.log('✅ Email delivered via Resend API (ID:', data.id, ')');
      return { success: true, provider: 'resend', id: data.id };
    } catch (err) {
      console.warn('⚠️ Resend API failed, checking fallbacks:', err.message);
    }
  }

  // 2. Brevo REST API (HTTPS port 443)
  if (process.env.BREVO_API_KEY) {
    try {
      const senderEmail = process.env.BREVO_SENDER || emailUser || 'loopnexstore@gmail.com';
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: fromName, email: senderEmail },
          to: [{ email: to }],
          replyTo: replyTo ? { email: replyTo } : undefined,
          subject,
          textContent: text,
          htmlContent: html
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Brevo delivery rejected');
      console.log('✅ Email delivered via Brevo API');
      return { success: true, provider: 'brevo', id: data.messageId };
    } catch (err) {
      console.warn('⚠️ Brevo API failed, checking fallbacks:', err.message);
    }
  }

  // 3. Nodemailer SMTP (Localhost or VPS/Cloud with open SMTP ports)
  if (transporter && emailUser && emailPass) {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${emailUser}>`,
      to,
      replyTo,
      subject,
      text,
      html
    });
    console.log('✅ Email delivered via Nodemailer SMTP (ID:', info.messageId, ')');
    return { success: true, provider: 'nodemailer', id: info.messageId };
  }

  throw new Error('No working email provider available. Set RESEND_API_KEY or EMAIL_USER/EMAIL_PASS.');
}

// Helper: Strict Email Validation Regex (RFC standard)
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleaned = email.trim();
  if (cleaned.length < 5 || cleaned.length > 254) return false;
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(cleaned);
}

// In-Memory Rate Limiter Middleware (Anti-Bot & Anti-Spam Protection)
const requestRateMap = new Map();

// Periodic cleanup of rate limiting map every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestRateMap.entries()) {
    if (now - record.firstReqTime > 15 * 60 * 1000) {
      requestRateMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

function createRateLimiter(maxRequests, windowMs, actionName = 'requests') {
  return (req, res, next) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.ip || req.socket?.remoteAddress || 'unknown-ip';
    const key = `${ip}:${actionName}`;
    const now = Date.now();
    const record = requestRateMap.get(key) || { count: 0, firstReqTime: now };

    if (now - record.firstReqTime > windowMs) {
      record.count = 1;
      record.firstReqTime = now;
    } else {
      record.count++;
    }

    requestRateMap.set(key, record);

    if (record.count > maxRequests) {
      const remainingSec = Math.ceil((windowMs - (now - record.firstReqTime)) / 1000);
      return res.status(429).json({
        success: false,
        error: `Too many ${actionName} attempts. Please wait ${remainingSec} seconds before trying again.`
      });
    }

    next();
  };
}

const loginRateLimiter = createRateLimiter(5, 5 * 60 * 1000, 'login');
const enquiryRateLimiter = createRateLimiter(5, 10 * 60 * 1000, 'enquiry');

// Backend Config API
app.get('/api/config', (req, res) => {
  res.json({
    dashboardVideo: process.env.DASHBOARD_VIDEO_URL || '',
    homeVideo: process.env.HOME_VIDEO_URL || '',
    linkedin: process.env.LINKEDIN_URL || 'https://www.linkedin.com/company/loopnex-hub/',
    whatsappChat: `https://wa.me/${process.env.WHATSAPP_NUMBER || '916386449592'}`,
    whatsappNumber: process.env.WHATSAPP_NUMBER || '916386449592',
    twitter: process.env.TWITTER_URL || 'https://x.com/loopn_ex',
    instagram: process.env.INSTAGRAM_URL || 'https://instagram.com/loopn_ex',
    threads: process.env.THREADS_URL || 'https://www.threads.net/@loopn_ex',
    email: process.env.CONTACT_EMAIL || process.env.EMAIL_USER || 'loopnexstore@gmail.com'
  });
});

// Health check API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Login Alert API with Rate Limiting & Non-Blocking User Experience
app.post('/api/send-login-alert', loginRateLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const recipient = process.env.NOTIFICATION_EMAIL || process.env.CONTACT_EMAIL || emailUser || 'loopnexstore@gmail.com';

  // Asynchronously dispatch notification without ever blocking user login flow
  sendEmailNotification({
    to: recipient,
    replyTo: cleanEmail,
    subject: `🚀 New User Logged In: ${cleanEmail}`,
    text: `A new user has logged in:\n\nEmail: ${cleanEmail}\nTime: ${timestamp} IST`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0f2fe; border-radius: 16px; background-color: #f0f9ff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #0369a1; font-size: 24px; margin: 0;">Loopnex Studio</h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">User Sign-in Activity</p>
        </div>
        <div style="background: #ffffff; padding: 20px; border-radius: 12px; border: 1px solid #bae6fd;">
          <h2 style="color: #0f172a; font-size: 18px; margin-top: 0;">🚀 New User Connected</h2>
          <p style="font-size: 15px; color: #334155; margin: 10px 0;"><strong>User Email:</strong> <a href="mailto:${cleanEmail}" style="color: #0284c7;">${cleanEmail}</a></p>
          <p style="font-size: 13px; color: #64748b; margin: 10px 0;"><strong>Timestamp:</strong> ${timestamp} (IST)</p>
        </div>
        <p style="text-align: center; font-size: 12px; color: #94a3b8; margin-top: 20px;">
          Loopnex Automated Notification System
        </p>
      </div>
    `,
    fromName: 'Loopnex Alert'
  }).then(result => {
    console.log(`✅ Login alert delivered for ${cleanEmail} via ${result.provider}`);
  }).catch(err => {
    console.warn(`ℹ️ Login alert notification skipped (${err.message}). User login succeeded uninterrupted.`);
  });

  // Always return success so the user's login and dashboard entry is never interrupted
  res.json({ success: true, message: 'Login recorded successfully' });
});

// Enquiry API with Rate Limiting & Strict Validation
app.post('/api/send-enquiry', enquiryRateLimiter, async (req, res) => {
  const { name, email, service, message } = req.body;

  if (!name || !email || !service || !message) {
    return res.status(400).json({ success: false, error: 'All fields (name, email, service, message) are required.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  const cleanName = name.trim().slice(0, 100);
  const cleanEmail = email.trim().toLowerCase();
  const cleanService = service.trim().slice(0, 100);
  const cleanMessage = message.trim().slice(0, 2000);
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const recipient = process.env.CONTACT_EMAIL || process.env.NOTIFICATION_EMAIL || emailUser || 'loopnexstore@gmail.com';

  try {
    const result = await sendEmailNotification({
      to: recipient,
      replyTo: cleanEmail,
      subject: `🔔 New Enquiry from ${cleanName} (${cleanService})`,
      text: `New Client Enquiry:\n\nName: ${cleanName}\nEmail: ${cleanEmail}\nService: ${cleanService}\nMessage:\n${cleanMessage}\n\nReceived at: ${timestamp} IST`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0f2fe; border-radius: 16px; background-color: #f0f9ff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #0369a1; font-size: 26px; margin: 0;">Loopnex Studio</h1>
            <p style="color: #0284c7; font-size: 14px; margin-top: 4px; font-weight: 600;">NEW CLIENT ENQUIRY</p>
          </div>
          
          <div style="background: #ffffff; padding: 24px; border-radius: 12px; border: 1px solid #bae6fd; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            <h2 style="color: #0f172a; font-size: 18px; margin-top: 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px;">
              Contact Information
            </h2>
            
            <table style="width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 110px;"><strong>Client Name:</strong></td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${cleanName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;"><strong>Email:</strong></td>
                <td style="padding: 8px 0;"><a href="mailto:${cleanEmail}" style="color: #0284c7; text-decoration: none; font-weight: 600;">${cleanEmail}</a></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;"><strong>Service:</strong></td>
                <td style="padding: 8px 0;"><span style="background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 13px;">${cleanService}</span></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;"><strong>Time:</strong></td>
                <td style="padding: 8px 0; color: #64748b;">${timestamp} IST</td>
              </tr>
            </table>

            <div style="margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 14px;">
              <h3 style="color: #0f172a; font-size: 15px; margin-bottom: 8px;">Message:</h3>
              <div style="background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0; color: #334155; line-height: 1.6; white-space: pre-wrap;">${cleanMessage}</div>
            </div>

            <div style="margin-top: 24px; text-align: center;">
              <a href="mailto:${cleanEmail}?subject=Re: Your Enquiry with Loopnex Studio (${encodeURIComponent(cleanService)})" style="display: inline-block; background: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 9999px; font-weight: 600; font-size: 14px;">
                Reply Directly to ${cleanName} →
              </a>
            </div>
          </div>

          <p style="text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px;">
            © 2026 Loopnex Studio · Sent automatically from your website reach form
          </p>
        </div>
      `,
      fromName: `Loopnex Enquiry - ${cleanName}`
    });

    console.log('✅ Enquiry email processed successfully from:', cleanName, `(${cleanEmail})`);
    res.json({ success: true, message: 'Message sent successfully!' });
  } catch (error) {
    console.error('❌ Error sending enquiry email:', error.message);
    
    // Check if error is Render SMTP port block
    if (error.code === 'ENETUNREACH' || error.code === 'ETIMEDOUT' || (error.message && error.message.includes('ENETUNREACH'))) {
      return res.status(500).json({
        success: false,
        error: 'Email service temporary network restriction on cloud server. Please reach us directly on WhatsApp (+91 6386449592)!'
      });
    }

    res.status(500).json({ success: false, error: error.message || 'Failed to send enquiry.' });
  }
});

// Explicit JSON 404 for API endpoints (Express 5 compatible)
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Fallback for SPA routing (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handler - guarantees JSON response for API or server errors
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Loopnex Server running securely at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = Number(PORT) + 1;
    console.warn(`⚠️ Port ${PORT} is in use, automatically switching to http://localhost:${nextPort}`);
    app.listen(nextPort, () => {
      console.log(`🚀 Loopnex Server running securely at http://localhost:${nextPort}`);
    });
  } else {
    console.error('Server error:', err);
  }
});