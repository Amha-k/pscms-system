const bcrypt = require('bcrypt');
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // put your new client ID in .env
// Simple unique ID generator for pharmacies
function generatePharmacyId() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 100000); // 5-digit random number
  return `PHA-${year}-${String(random).padStart(5, '0')}`;
}
async function createNotification(recipientRole, message, type, triggerRole, specificRecipientIds = []) {
    try {
        for (const recipientId of specificRecipientIds) {
            // avoid duplicates
            const [existing] = await pool.query(
                `SELECT 1 FROM notifications 
                 WHERE recipient_id = ? AND message = ? AND type = ? AND trigger_role = ?`,
                [recipientId, message, type, triggerRole]
            );
            if (existing.length === 0) {
                await pool.query(
                    `INSERT INTO notifications 
                     (notification_id, recipient_id, recipient_role, message, type, created_at, is_read, trigger_role) 
                     VALUES (?, ?, ?, ?, ?, NOW(), 0, ?)`,
                    [`NTF-${Date.now()}-${Math.floor(Math.random() * 10000)}`, recipientId, recipientRole, message, type, triggerRole]
                );
            }
        }
    } catch (err) {
        console.error('Notification creation failed:', err.message);
    }
}
exports.googleLogin = async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ message: 'Google credential is required' });

  try {
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload(); // contains email, name, picture, etc.
    const email = payload.email;
    const name = payload.name;

    // Check if pharmacy exists
    const [rows] = await pool.query('SELECT * FROM pharmacy WHERE username = ?', [email]);
    let pharmacy = null;

    if (rows.length === 0) {
      // Create new pharmacy automatically with "pending" status
      const pharmacyId = generatePharmacyId();
      const randomPassword = Math.random().toString(36).slice(-8); // random password

      await pool.query(
        'INSERT INTO pharmacy (pharmacy_id, name, address, phone_No, username, password, status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [pharmacyId, name || 'N/A', 'N/A', 'N/A', email, await bcrypt.hash(randomPassword, 10), 'pending', true]
      );

      // ✅ Do not issue token here
      return res.status(200).json({
        message: "Your request has been sent to the administrator. Please wait for approval before signing in.",
      });
    } else {
      pharmacy = rows[0];
      if (!pharmacy.is_active) {
        return res.status(403).json({ message: 'Your account has been deactivated. Please contact support.' });
      }
      if (pharmacy.status !== 'approved') {
        return res.status(403).json({
          message: 'Your account is still pending approval by the administrator. Please wait until it is approved.',
        });
      }
    }

    // Issue JWT for existing + approved users
    const token = jwt.sign(
      { pharmacyId: pharmacy.pharmacy_id, username: pharmacy.username },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ token, pharmacyId: pharmacy.pharmacy_id, name: pharmacy.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Google login failed', error: err.message });
  }
};

exports.register = async (req, res) => {
  const { name, address, phone_No, username, password } = req.body;
  if (!name || !address || !phone_No || !username || !password) {
    return res.status(400).json({ message: 'Name, address, phone_No, username, password are required' });
  }

  try {
    const [existing] = await pool.query('SELECT pharmacy_id FROM pharmacy WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const pharmacyId = generatePharmacyId();

    await pool.query(
      'INSERT INTO pharmacy (pharmacy_id, name, address, phone_No, username, password, status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [pharmacyId, name, address, phone_No, username, hashedPassword, 'pending', true]
    );

    // 🔔 Create notification for all admins
    await createNotification(
      'admin',
      `New pharmacy "${name}" registered and is awaiting approval.`,
      'add_pharmacy',
      'pharmacy'
      // no specificRecipientIds → goes to all admins
    );

    res.status(201).json({ message: 'Pharmacy registered successfully. Awaiting admin approval.', pharmacyId });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM pharmacy WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const pharmacy = rows[0];
    const match = await bcrypt.compare(password, pharmacy.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // ✅ Check if pharmacy is active
    if (!pharmacy.is_active) {
      return res.status(403).json({ message: 'Your account has been deactivated. Please contact support.' });
    }

    if (pharmacy.status !== 'approved') {
      return res.status(403).json({ message: 'Account pending approval by admin' });
    }

    const token = jwt.sign(
      { pharmacyId: pharmacy.pharmacy_id, username: pharmacy.username },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ token, pharmacyId: pharmacy.pharmacy_id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


// Get pharmacy dashboard statistics using existing tables
exports.getDashboardStats = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  if (!pharmacyId) {
    return res.status(403).json({ message: 'Authentication required' });
  }
  try {
    const [[totalOrders]] = await pool.query(
      "SELECT COUNT(*) as count FROM request WHERE pharmacy_id = ? AND status = 'Approved' AND order_id IS NOT NULL",
      [pharmacyId]
    );

    const [[pendingRequests]] = await pool.query(
      "SELECT COUNT(*) as count FROM request WHERE pharmacy_id = ? AND status = 'Pending'",
      [pharmacyId]
    );

    const [[totalSpent]] = await pool.query(
      `SELECT COALESCE(SUM(p.price * r.quantity), 0) as total 
       FROM request r 
       JOIN products p ON p.name = r.product_name AND p.wholesaler_id = r.wholesaler_id
       WHERE r.pharmacy_id = ? AND r.status = 'Approved'`,
      [pharmacyId]
    );

    const [recentOrders] = await pool.query(
      `SELECT r.order_id, r.product_name, r.quantity, r.order_date, w.name as wholesaler_name
       FROM request r
       JOIN wholesalers w ON w.wholesaler_id = r.wholesaler_id
       WHERE r.pharmacy_id = ? AND r.status = 'Approved' AND r.order_id IS NOT NULL
       ORDER BY r.order_date DESC LIMIT 5`,
      [pharmacyId]
    );

    res.json({
      totalOrders: totalOrders.count || 0,
      pendingRequests: pendingRequests.count || 0,
      totalSpent: totalSpent.total || 0,
      recentOrders: recentOrders
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Get pharmacy orders (approved requests with order_id)
exports.getOrders = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  if (!pharmacyId) {
    return res.status(403).json({ message: 'Authentication required' });
  }
  try {
    const [orders] = await pool.query(
      `SELECT r.order_id, r.request_id, r.product_name, r.quantity, r.order_date, r.status,
              w.name as wholesaler_name, w.address as wholesaler_address
       FROM request r
       JOIN wholesalers w ON w.wholesaler_id = r.wholesaler_id
       WHERE r.pharmacy_id = ? AND r.status = 'Approved' AND r.order_id IS NOT NULL
       ORDER BY r.order_date DESC`,
      [pharmacyId]
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Get pharmacy inventory (products from all wholesalers)
exports.getInventory = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  if (!pharmacyId) {
    return res.status(403).json({ message: 'Authentication required' });
  }
  try {
    const [inventory] = await pool.query(
      `SELECT p.product_id, p.name, p.description, p.price, r.quantity, p.expire_date,p.created_at,p.last_price_update,
              w.name as wholesaler_name, w.address as wholesaler_address, w.wholesaler_id
       FROM products p
       JOIN wholesalers w ON w.wholesaler_id = p.wholesaler_id
       JOIN request r ON r.product_name = p.name AND r.wholesaler_id = p.wholesaler_id
       WHERE r.pharmacy_id = ? AND r.status = 'Approved' AND w.status = 'approved'
       ORDER BY p.name ASC, p.price ASC`,
      [pharmacyId]
    );

    res.json(inventory);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
exports.getPharmacyInventory = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  const { productId } = req.params;
  if (!pharmacyId) {
    return res.status(403).json({ message: 'Authentication required' });
  }
  try {
    const [inventory] = await pool.query(
      `SELECT * FROM pharmacy_inventory WHERE pharmacy_id= ? AND product_id=?`,
      [pharmacyId,productId]
    );

    res.json(inventory);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.updateInventoryItem = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  const { productId } = req.params;
  const { quantity } = req.body;

  if (!pharmacyId) return res.status(403).json({ message: 'Authentication required' });
  if (quantity == null || quantity < 0) return res.status(400).json({ message: 'Quantity must be non-negative' });

  try {
    const [result] = await pool.query(
      `UPDATE pharmacy_inventory
       SET quantity = ?, last_updated = NOW()
       WHERE pharmacy_id = ? AND product_id = ?`,
      [quantity, pharmacyId, productId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found in your inventory' });
    }

    res.json({ message: 'Inventory updated successfully', productId, quantity });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


// Get pharmacy notifications
exports.getNotifications = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  if (!pharmacyId) {
    return res.status(403).json({ message: 'Authentication required' });
  }
  try {
    const [notifications] = await pool.query(
      `SELECT 
          request_id as notification_id,
          'request_update' as type,
          CASE 
            WHEN status = 'Approved' THEN 'Request Approved'
            WHEN status = 'Rejected' THEN 'Request Rejected'
            WHEN status = 'notification' THEN 'System Notification'
            ELSE 'Request Updated'
          END as title,
          notification_message as message,
          order_date as created_at,
          notification_sent as is_read
       FROM request 
       WHERE pharmacy_id = ? AND (status IN ('Approved', 'Rejected', 'notification') OR notification_message IS NOT NULL)
       ORDER BY order_date DESC LIMIT 20`,
      [pharmacyId]
    );
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Mark notification as read
exports.markNotificationRead = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  const { requestId } = req.params;
  if (!pharmacyId) {
    return res.status(403).json({ message: 'Authentication required' });
  }
  try {
    const [result] = await pool.query(
      'UPDATE request SET notification_sent = TRUE WHERE request_id = ? AND pharmacy_id = ?',
      [requestId, pharmacyId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
// ✅ Get logged-in pharmacy profile
exports.getProfile = async (req, res) => {
  try {
    const pharmacyId = req.user.pharmacyId; // from JWT middleware
    const [rows] = await pool.query(
      'SELECT pharmacy_id, name, address, phone_No, username, status, created_at FROM pharmacy WHERE pharmacy_id = ?',
      [pharmacyId]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Pharmacy not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ✅ Update pharmacy profile
exports.updateProfile = async (req, res) => {
  try {
    const pharmacyId = req.user.pharmacyId;
    const { name, address, phone_No, username } = req.body;

    if (!name || !address || !phone_No || !username) {
      return res.status(400).json({ message: 'Name, address, phone_No, and username are required' });
    }

    // Check if username is taken by another pharmacy
    const [existing] = await pool.query(
      'SELECT pharmacy_id FROM pharmacy WHERE username = ? AND pharmacy_id != ?',
      [username, pharmacyId]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username already in use' });
    }

    await pool.query(
      'UPDATE pharmacy SET name = ?, address = ?, phone_No = ?, username = ? WHERE pharmacy_id = ?',
      [name, address, phone_No, username, pharmacyId]
    );

    const [updated] = await pool.query(
      'SELECT pharmacy_id, name, address, phone_No, username FROM pharmacy WHERE pharmacy_id = ?',
      [pharmacyId]
    );

    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ✅ Change pharmacy password
exports.changePassword = async (req, res) => {
  try {
    const pharmacyId = req.user.pharmacyId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Both current and new password are required' });
    }

    const [rows] = await pool.query(
      'SELECT password FROM pharmacy WHERE pharmacy_id = ?',
      [pharmacyId]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Pharmacy not found' });

    const match = await bcrypt.compare(currentPassword, rows[0].password);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE pharmacy SET password = ? WHERE pharmacy_id = ?',
      [hashedPassword, pharmacyId]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

