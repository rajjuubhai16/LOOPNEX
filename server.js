require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5500;

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

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: emailUser,
    pass: emailPass
  }
});

// Verify SMTP connection on server startup
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Gmail SMTP Error:', error.message);
  } else {
    console.log('✅ Gmail SMTP Server is ready to send emails');
  }
});

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

function createRateLimiter(maxRequests, windowMs, actionName = 'requests') {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
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

// Login Alert API with Rate Limiting & Strict Email Validation
app.post('/api/send-login-alert', loginRateLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please provide a valid email address.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const mailOptions = {
      from: `"Loopnex Alert" <${emailUser}>`,
      to: emailUser,
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
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Login alert sent for:', cleanEmail, info.messageId);
    res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('❌ Error sending login alert:', error);
    res.status(500).json({ success: false, error: error.message });
  }
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

  try {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const mailOptions = {
      from: `"Loopnex Enquiry - ${name}" <${emailUser}>`,
      to: emailUser,
      replyTo: email,
      subject: `🔔 New Enquiry from ${name} (${service})`,
      text: `New Client Enquiry:\n\nName: ${name}\nEmail: ${email}\nService: ${service}\nMessage:\n${message}\n\nReceived at: ${timestamp} IST`,
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
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${name}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;"><strong>Email:</strong></td>
                <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #0284c7; text-decoration: none; font-weight: 600;">${email}</a></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;"><strong>Service:</strong></td>
                <td style="padding: 8px 0;"><span style="background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 13px;">${service}</span></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;"><strong>Time:</strong></td>
                <td style="padding: 8px 0; color: #64748b;">${timestamp} IST</td>
              </tr>
            </table>

            <div style="margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 14px;">
              <h3 style="color: #0f172a; font-size: 15px; margin-bottom: 8px;">Message:</h3>
              <div style="background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0; color: #334155; line-height: 1.6; white-space: pre-wrap;">${message}</div>
            </div>

            <div style="margin-top: 24px; text-align: center;">
              <a href="mailto:${email}?subject=Re: Your Enquiry with Loopnex Studio (${encodeURIComponent(service)})" style="display: inline-block; background: #0284c7; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 9999px; font-weight: 600; font-size: 14px;">
                Reply Directly to ${name} →
              </a>
            </div>
          </div>

          <p style="text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px;">
            © 2026 Loopnex Studio · Sent automatically from your website reach form
          </p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Enquiry email sent successfully from:', name, `(${email})`, 'ID:', info.messageId);
    res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('❌ Error sending enquiry email:', error);
    res.status(500).json({ success: false, error: error.message });
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