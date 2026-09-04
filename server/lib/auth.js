const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');

const SECRET = process.env.JWT_SECRET || 'shorja-dev-secret';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

function authRequired(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'يرجى تسجيل الدخول' });
    try {
      const data = verifyToken(token);
      if (roles.length && !roles.includes(data.role)) {
        return res.status(403).json({ ok: false, error: 'صلاحيات غير كافية' });
      }
      req.user = data;
      next();
    } catch {
      return res.status(401).json({ ok: false, error: 'انتهت الجلسة' });
    }
  };
}

function authSyncKey(req, res, next) {
  const expected = process.env.SYNC_KEY || '';
  const key = req.headers['x-sync-key'] || req.body?.syncKey || '';
  if (expected && key !== expected) {
    return res.status(403).json({ ok: false, error: 'مفتاح المزامنة غير صحيح' });
  }
  next();
}

/** مفتاح تكامل بوابة المندوبين (DELEGATE_INTEGRATION_KEY = SYNC_API_KEY في delegate-portal). */
function authDelegateIntegration(req, res, next) {
  const key = req.headers['x-sync-key'] || req.body?.syncKey || '';
  const integrationKey = String(process.env.DELEGATE_INTEGRATION_KEY || '').trim();
  const syncKey = String(process.env.SYNC_KEY || '').trim();
  if (integrationKey && key === integrationKey) return next();
  if (syncKey && key === syncKey) return next();
  if (!integrationKey && !syncKey) return next();
  return res.status(403).json({ ok: false, error: 'مفتاح التكامل غير صحيح' });
}

function stripBidi(value) {
  return String(value || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u00A0\u202F]/g, ' ')
    .trim();
}

function normalizeDigits(value) {
  return String(value || '').replace(/[٠-٩۰-۹]/g, (ch) => {
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    const i = arabic.indexOf(ch);
    if (i >= 0) return String(i);
    const j = persian.indexOf(ch);
    return j >= 0 ? String(j) : ch;
  });
}

function normalizeUsername(username) {
  return stripBidi(username).toLowerCase();
}

function normalizePassword(password) {
  return normalizeDigits(stripBidi(password));
}

function sessionForUser(user) {
  const payload = {
    id: Number(user.id),
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    branchId: user.branch_id != null ? Number(user.branch_id) : null,
    branchCode: user.branch_code,
    branchName: user.branch_name
  };
  return { token: signToken(payload), user: payload };
}

function login(username, password) {
  const userName = normalizeUsername(username);
  const pass = normalizePassword(password);
  const user = db.prepare(`
    SELECT u.*, b.code AS branch_code, b.name AS branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id
    WHERE lower(u.username) = ? AND u.is_active = 1
  `).get(userName);
  if (!user || !bcrypt.compareSync(pass, user.password_hash)) {
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  return sessionForUser(user);
}

function openPosSession() {
  const user = db.prepare(`
    SELECT u.*, b.code AS branch_code, b.name AS branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.role = 'branch' AND u.is_active = 1
    ORDER BY CASE WHEN u.username = 'branch' THEN 0 ELSE 1 END, u.id
    LIMIT 1
  `).get();
  if (!user) throw new Error('حساب نقطة البيع غير موجود');
  return sessionForUser(user);
}

function getMe(userId) {
  const user = db.prepare(`
    SELECT u.*, b.code AS branch_code, b.name AS branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.id = ? AND u.is_active = 1
  `).get(userId);
  if (!user) return null;
  return {
    id: Number(user.id),
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    branchId: user.branch_id != null ? Number(user.branch_id) : null,
    branchCode: user.branch_code,
    branchName: user.branch_name
  };
}

module.exports = {
  signToken,
  verifyToken,
  authRequired,
  authSyncKey,
  authDelegateIntegration,
  login,
  openPosSession,
  getMe
};
