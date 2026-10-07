import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './crm.js';

const SESSION_DAYS = 30;
const MIN_PASSWORD = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// Verified against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/** Fixed-window rate limiter keyed by e.g. IP address. */
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= max;
  };
}

const userOut = ({ password_hash: _, ...u }) => u;

export class Auth {
  constructor(db) {
    this.db = db;
    // While nobody has an account, creating the first one requires this token,
    // which is only printed to the server log.
    this.setupToken = this.userCount() ? null : randomBytes(18).toString('base64url');
  }

  userCount() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  listUsers() {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at, id').all().map(userOut);
  }

  createUser({ email, name, password }) {
    email = String(email ?? '').trim().toLowerCase();
    name = String(name ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'A valid email is required');
    if (!name) throw new HttpError(400, 'Name is required');
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
    }
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'A user with that email already exists');
    }
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(email, name, hashPassword(password), new Date().toISOString());
    this.setupToken = null;
    return userOut(this.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(lastInsertRowid)));
  }

  /** Creates the first account, guarded by the one-time setup token. */
  setup({ token, ...user }) {
    if (!this.setupToken) throw new HttpError(409, 'Setup is already complete; sign in instead');
    const given = Buffer.from(String(token ?? ''));
    const expected = Buffer.from(this.setupToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError(403, 'Invalid setup token. Find it in the server log.');
    }
    return this.createUser(user);
  }

  deleteUser(id, currentUserId) {
    if (Number(id) === currentUserId) throw new HttpError(400, "You can't delete your own account");
    const { changes } = this.db.prepare('DELETE FROM users WHERE id = ?').run(Number(id));
    if (!changes) throw new HttpError(404, 'User not found');
  }

  changePassword(userId, current, next) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || !verifyPassword(current ?? '', user.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    if (typeof next !== 'string' || next.length < MIN_PASSWORD) {
      throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
    }
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), userId);
    // Sign out every other session.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return this.#startSession(userId);
  }

  login(email, password) {
    const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(String(email ?? '').trim().toLowerCase());
    const ok = verifyPassword(String(password ?? ''), user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Incorrect email or password');
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    return { token: this.#startSession(user.id), user: userOut(user) };
  }

  #startSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString(), now.toISOString());
    return token;
  }

  sessionUser(token) {
    if (!token) return null;
    const row = this.db
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
      .get(sha256(token), new Date().toISOString());
    return row ? userOut(row) : null;
  }

  logout(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86400;
