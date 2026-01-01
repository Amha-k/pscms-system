const bcrypt = require('bcrypt');
const pool = require('../config/db');
const jwt = require('jsonwebtoken');

// Simple unique ID generator for wholesalers
function generateWholesalerId() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 100000); // 5-digit random number
  return `WHO-${year}-${String(random).padStart(5, '0')}`;
}

exports.register = async (req, res) => {
  const { name, address, username, password, status } = req.body;
  if (!name || !address || !username || !password || !status) {
    return res.status(400).json({ message: 'Name, address, username, password, status are required' });
  }
  try {
    const [existing] = await pool.query('SELECT wholesaler_id FROM wholesalers WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'username already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const wholesalerId = generateWholesalerId();

    await pool.query(
      'INSERT INTO wholesalers (wholesaler_id, name, address, username, password, status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [wholesalerId, name, address, username, hashedPassword, status, true]   // ✅ new wholesalers always active
    );

    res.status(201).json({ message: 'Wholesaler registered successfully', wholesalerId });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'username and password are required' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM wholesalers WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const wholesaler = rows[0];

    // ✅ check if account is active
    if (!wholesaler.is_active) {
      return res.status(403).json({ message: 'Your account is currently inactive. Please contact support for assistance.' });
    }

    const match = await bcrypt.compare(password, wholesaler.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { wholesalerId: wholesaler.wholesaler_id, username: wholesaler.username },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    res.json({ token, wholesalerId: wholesaler.wholesaler_id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


// ✅ New: get logged-in wholesaler profile
exports.getProfile = async (req, res) => {
  try {
    const wholesalerId = req.user.wholesalerId; // from JWT middleware
    const [rows] = await pool.query('SELECT wholesaler_id, name, address, username FROM wholesalers WHERE wholesaler_id = ?', [wholesalerId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Wholesaler not found' });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const wholesalerId = req.user.wholesalerId;
    const { name, address, username } = req.body;

    if (!name || !address || !username) {
      return res.status(400).json({ message: 'Name, address, and username are required' });
    }

    // Check if username is taken by another user
    const [existing] = await pool.query(
      'SELECT wholesaler_id FROM wholesalers WHERE username = ? AND wholesaler_id != ?',
      [username, wholesalerId]
    );
    if (existing.length > 0) return res.status(409).json({ message: 'Username already in use' });

    await pool.query(
      'UPDATE wholesalers SET name = ?, address = ?, username = ? WHERE wholesaler_id = ?',
      [name, address, username, wholesalerId]
    );

    const [updatedRows] = await pool.query(
      'SELECT name, address, username FROM wholesalers WHERE wholesaler_id = ?',
      [wholesalerId]
    );

    res.json(updatedRows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
// Change password
exports.changePassword = async (req, res) => {
  try {
    const wholesalerId = req.user.wholesalerId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Both current and new password are required' });
    }

    const [rows] = await pool.query('SELECT password FROM wholesalers WHERE wholesaler_id = ?', [wholesalerId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Wholesaler not found' });

    const match = await bcrypt.compare(currentPassword, rows[0].password);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE wholesalers SET password = ? WHERE wholesaler_id = ?', [hashedPassword, wholesalerId]);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
// ✅ Get all notifications for the logged-in wholesaler
exports.getNotifications = async (req, res) => {
  try {
    const wholesalerId = req.user.wholesalerId; // from JWT
    const [rows] = await pool.query(
      `SELECT notification_id, recipient_id, recipient_role, message, type, created_at, is_read, trigger_role
       FROM notifications 
       WHERE recipient_role = 'wholesaler' AND recipient_id = ?
       ORDER BY created_at DESC`,
      [wholesalerId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
