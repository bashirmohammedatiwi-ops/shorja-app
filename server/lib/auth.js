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

function login(username, password) {
  const user = db.prepare(`
    SELECT u.*, b.code AS branch_code, b.name AS branch_name
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.username = ? AND u.is_active = 1
  `).get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  const token = signToken({
    id: Number(user.id),
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    branchId: user.branch_id != null ? Number(user.branch_id) : null,
    branchCode: user.branch_code,
    branchName: user.branch_name
  });
  return {
    token,
    user: {
      id: Number(user.id),
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      branchId: user.branch_id != null ? Number(user.branch_id) : null,
      branchCode: user.branch_code,
      branchName: user.branch_name
    }
  };
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
  login,
  getMe
};
