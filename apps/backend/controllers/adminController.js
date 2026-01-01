const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
// --- Notification helper ---
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

exports.register = async (req, res) => {
  const { name, address, username, password, status } = req.body;

  if (!name || !address || !username || !password || !status) {
    return res.status(400).json({ message: 'Name, address, username, password, status are required' });
  }

  try {
    console.log("👉 Admin register wholesaler called by:", req.user);

    const [existing] = await pool.query(
      'SELECT wholesaler_id FROM wholesalers WHERE username = ?',
      [username]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const wholesalerId = `WHO-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000)}`;

    await pool.query(
      'INSERT INTO wholesalers (wholesaler_id, name, address, username, password, status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [wholesalerId, name, address, username, hashedPassword, status, true]
    );

    // 🔔 Notification

    // notify the admin who did the action (for auditing/logging)
    if (req.user?.adminId) {
      await createNotification(
        'admin',
        `Wholesaler "${name}" has been registered successfully.`,
        'register_wholesaler',
        'admin',
        [req.user.adminId]   // recipient is current admin
      );
    }

    res.status(201).json({
      message: 'Wholesaler registered successfully',
      wholesalerId,
    });
  } catch (err) {
    console.error('❌ Register error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};



exports.getAllWholesalers = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT wholesaler_id, name, address, username, status, created_at,is_Active FROM wholesalers ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.getAllPharmacies = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT pharmacy_id, name, address, phone_No, username, status, created_at,is_active FROM pharmacy ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Dashboard stats: totals and pending approvals
exports.getDashboardStats = async (req, res) => {
    try {
        const [[wholesalerCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM wholesalers');
        const [[pharmacyCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM pharmacy');
        const [[pendingWholesalersRow]] = await pool.query("SELECT COUNT(*) AS pending FROM wholesalers WHERE status = 'pending'");
        const [[pendingPharmaciesRow]] = await pool.query("SELECT COUNT(*) AS pending FROM pharmacy WHERE status = 'pending'");

        res.json({
            totalWholesalers: wholesalerCountRow.total || 0,
            totalPharmacies: pharmacyCountRow.total || 0,
            pendingApprovals: (pendingWholesalersRow.pending || 0) + (pendingPharmaciesRow.pending || 0)
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Wholesaler growth over time: monthly counts for last 12 months
exports.getWholesalerGrowth = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT DATE_FORMAT(created_at, '%Y-%m') AS period, COUNT(*) AS count
            FROM wholesalers
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY period ASC
        `);

        // Ensure all months present with zero fill for frontend charting
        const result = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const match = rows.find(r => r.period === key);
            result.push({ period: key, count: match ? match.count : 0 });
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Approve a pharmacy by ID
exports.approvePharmacy = async (req, res) => {
    const { pharmacyId } = req.params;
    if (!pharmacyId) {
        return res.status(400).json({ message: 'pharmacyId is required' });
    }
    try {
        const [result] = await pool.query('UPDATE pharmacy SET status = ? WHERE pharmacy_id = ?', ['approved', pharmacyId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pharmacy not found' });
        }

        // 🔔 notify pharmacy + admin
        await createNotification(
            'pharmacy',
            `Your pharmacy account has been approved.`,
            'approve_pharmacy_request',
            'admin',
            [pharmacyId]
        );
        await createNotification(
            'admin',
            `Pharmacy with ID ${pharmacyId} has been approved.`,
            'approve_pharmacy_request',
            'admin',
            [req.user?.adminId || 'system']
        );

        res.json({ message: 'Pharmacy approved successfully', pharmacyId });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Reject a pharmacy by ID
exports.rejectPharmacy = async (req, res) => {
    const { pharmacyId } = req.params;
    if (!pharmacyId) {
        return res.status(400).json({ message: 'pharmacyId is required' });
    }
    try {
        const [result] = await pool.query('UPDATE pharmacy SET status = ? WHERE pharmacy_id = ?', ['rejected', pharmacyId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pharmacy not found' });
        }

        // 🔔 notify pharmacy + admin
        await createNotification(
            'pharmacy',
            `Your pharmacy account request was rejected.`,
            'disapprove_pharmacy_request',
            'admin',
            [pharmacyId]
        );
        await createNotification(
            'admin',
            `Pharmacy with ID ${pharmacyId} has been rejected.`,
            'disapprove_pharmacy_request',
            'admin',
            [req.user?.adminId || 'system']
        );

        res.json({ message: 'Pharmacy rejected successfully', pharmacyId });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Main super admin login (hardcoded credentials)
exports.login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const mainAdminUser = process.env.MAIN_ADMIN_USERNAME || 'superadmin';
    const mainAdminPass = process.env.MAIN_ADMIN_PASSWORD || 'superadmin123';

    // --- Superadmin login branch ---
    if (username === mainAdminUser) {
      // Check if superadmin exists in DB
      const [adminRows] = await pool.query(
        'SELECT * FROM admins WHERE username = ? AND role = "superadmin"',
        [mainAdminUser]
      );

      if (adminRows.length > 0) {
        // Use DB password
        const match = await bcrypt.compare(password, adminRows[0].password);
        if (!match) return res.status(401).json({ message: 'Invalid superadmin credentials' });

        const token = jwt.sign(
          {
            role: 'superadmin',
            username,
            isMainAdmin: true
          },
          process.env.JWT_SECRET,
          { expiresIn: '1d' }
        );

        return res.json({ token, role: 'superadmin', isMainAdmin: true });
      } else {
        // fallback to .env password
        if (password !== mainAdminPass) return res.status(401).json({ message: 'Invalid superadmin credentials' });

        const token = jwt.sign(
          {
            role: 'superadmin',
            username,
            isMainAdmin: true
          },
          process.env.JWT_SECRET,
          { expiresIn: '1d' }
        );

        return res.json({ token, role: 'superadmin', isMainAdmin: true });
      }
    }

    // --- Regular admin login branch ---
    const [regularAdminRows] = await pool.query(
      'SELECT * FROM admins WHERE username = ? AND status = "active"',
      [username]
    );
    if (regularAdminRows.length === 0) return res.status(401).json({ message: 'Invalid admin credentials' });

    const admin = regularAdminRows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ message: 'Invalid admin credentials' });

    const token = jwt.sign(
      {
        role: admin.role,        // 'admin'
        username: admin.username,
        adminId: admin.admin_id,
        isMainAdmin: false       // ALWAYS false for regular admins
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.json({
      token,
      role: admin.role,
      adminId: admin.admin_id,
      isMainAdmin: false
    });

  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Create new admin (only main admin can do this)
exports.createAdmin = async (req, res) => {
    // Check if the current user is the main admin
    if (!req.user || !req.user.isMainAdmin) {
        return res.status(403).json({ message: 'Only the main admin can create new admins' });
    }
    
    const { name, username, password, email, role = 'admin' } = req.body;
    
    if (!name || !username || !password) {
        return res.status(400).json({ message: 'Name, username, and password are required' });
    }
    
    try {
        // Check if username is already taken
        const [existingUser] = await pool.query('SELECT 1 FROM admins WHERE username = ?', [username]);
        if (existingUser.length > 0) {
            return res.status(409).json({ message: 'Username already taken' });
        }
        
        // Hash password and create admin
        const hashedPassword = await bcrypt.hash(password, 10);
        const adminId = uuidv4();
        
        await pool.query(
            'INSERT INTO admins (admin_id, name, username, password, email, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [adminId, name, username, hashedPassword, email || null, role, 'active']
        );
        
        res.status(201).json({ 
            message: 'Admin created successfully',
            adminId,
            username
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Get all admins (only main admin can see this)
exports.getAllAdmins = async (req, res) => {
    // Check if the current user is the main admin
    if (!req.user || !req.user.isMainAdmin) {
        return res.status(403).json({ message: 'Only the main admin can view all admins' });
    }
    
    try {
        const [admins] = await pool.query(
            'SELECT admin_id, name, username, email, role, status, created_at FROM admins ORDER BY created_at DESC'
        );
        res.json(admins);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Remove admin (only main admin can do this)
exports.removeAdmin = async (req, res) => {
    // Check if the current user is the main admin
    if (!req.user || !req.user.isMainAdmin) {
        return res.status(403).json({ message: 'Only the main admin can remove admins' });
    }
    
    const { adminId } = req.params;
    
    if (!adminId) {
        return res.status(400).json({ message: 'Admin ID is required' });
    }
    
    try {
        const [result] = await pool.query('DELETE FROM admins WHERE admin_id = ?', [adminId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Admin not found' });
        }
        
        res.json({ message: 'Admin removed successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Change main admin password
exports.changeMainAdminPassword = async (req, res) => {
    if (!req.user || !req.user.isMainAdmin) {
        return res.status(403).json({ message: 'Only the superadmin can change the password' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Current and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });

    try {
        const mainAdminUser = process.env.MAIN_ADMIN_USERNAME || 'superadmin';

        // Check DB for superadmin
        const [adminRows] = await pool.query('SELECT * FROM admins WHERE username = ? AND role = "superadmin"', [mainAdminUser]);

        if (adminRows.length > 0) {
            // Compare current password
            const match = await bcrypt.compare(currentPassword, adminRows[0].password);
            if (!match) return res.status(401).json({ message: 'Current password is incorrect' });

            // Update DB password
            const hashedNew = await bcrypt.hash(newPassword, 10);
            await pool.query('UPDATE admins SET password = ? WHERE username = ?', [hashedNew, mainAdminUser]);
        } else {
            // fallback to .env password
            const mainAdminPass = process.env.MAIN_ADMIN_PASSWORD || 'superadmin123';
            if (currentPassword !== mainAdminPass) return res.status(401).json({ message: 'Current password is incorrect' });

            const hashedNew = await bcrypt.hash(newPassword, 10);
            const adminId = uuidv4();
            await pool.query(
                'INSERT INTO admins (admin_id, name, username, password, email, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
                [adminId, 'Main Administrator', mainAdminUser, hashedNew, null, 'superadmin', 'active']
            );
        }

        return res.json({
            message: 'Superadmin password changed successfully. It works immediately. Update .env if needed.'
        });

    } catch (err) {
        return res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Get wholesaler full details by ID (excluding password)
exports.getWholesalerDetails = async (req, res) => {
    const { wholesalerId } = req.params;
    if (!wholesalerId) {
        return res.status(400).json({ message: 'wholesalerId is required' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT wholesaler_id, name, address, username, status, created_at,is_active FROM wholesalers WHERE wholesaler_id = ?',
            [wholesalerId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Wholesaler not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Get pharmacy full details by ID (excluding password)
exports.getPharmacyDetails = async (req, res) => {
    const { pharmacyId } = req.params;
    if (!pharmacyId) {
        return res.status(400).json({ message: 'pharmacyId is required' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT pharmacy_id, name, address, phone_No, username, status, created_at,is_active FROM pharmacy WHERE pharmacy_id = ?',
            [pharmacyId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Pharmacy not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

exports.getMe = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Not authorized" });
    }

    // If the user is superadmin, make sure to verify it in DB
    let isMainAdmin = false;
    if (req.user.role === 'superadmin') {
      const mainAdminUser = process.env.MAIN_ADMIN_USERNAME || 'superadmin';
      const [rows] = await pool.query(
        'SELECT 1 FROM admins WHERE username = ? AND role = "superadmin"',
        [mainAdminUser]
      );
      isMainAdmin = rows.length > 0; // true if superadmin exists in DB
    }

    res.json({
      username: req.user.username,
      role: req.user.role,
      adminId: req.user.adminId || null,
      isMainAdmin
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Toggle wholesaler active status (activate or deactivate)
exports.toggleWholesalerActiveStatus = async (req, res) => {
    const { wholesalerId } = req.params;
    const { is_active } = req.body; // expects true/false

    if (!wholesalerId || typeof is_active === 'undefined') {
        return res.status(400).json({ message: 'wholesalerId and is_active (true/false) are required' });
    }

    try {
        const [result] = await pool.query(
            'UPDATE wholesalers SET is_active = ? WHERE wholesaler_id = ?',
            [is_active, wholesalerId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Wholesaler not found' });
        }

        // 🔔 notify wholesaler + admin
        await createNotification(
            'wholesaler',
            `Your account has been ${is_active ? 'activated' : 'deactivated'}.`,
            is_active ? 'activate_wholesaler' : 'deactivate_wholesaler',
            'admin',
            [wholesalerId]
        );
        await createNotification(
            'admin',
            `Wholesaler with ID ${wholesalerId} has been ${is_active ? 'activated' : 'deactivated'}.`,
            is_active ? 'activate_wholesaler' : 'deactivate_wholesaler',
            'admin',
            [req.user?.adminId || 'system']
        );

        res.json({
            message: `Wholesaler has been ${is_active ? 'activated' : 'deactivated'} successfully`,
            wholesalerId,
            is_active
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Toggle pharmacy active status (activate or deactivate)
exports.togglePharmacyActiveStatus = async (req, res) => {
    const { pharmacyId } = req.params;
    const { is_active } = req.body; // expects true/false

    if (!pharmacyId || typeof is_active === 'undefined') {
        return res.status(400).json({ message: 'pharmacyId and is_active (true/false) are required' });
    }

    try {
        const [result] = await pool.query(
            'UPDATE pharmacy SET is_active = ? WHERE pharmacy_id = ?',
            [is_active, pharmacyId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pharmacy not found' });
        }

        // 🔔 notify pharmacy + admin
        await createNotification(
            'pharmacy',
            `Your account has been ${is_active ? 'activated' : 'deactivated'}.`,
            is_active ? 'activate_pharmacy' : 'deactivate_pharmacy',
            'admin',
            [pharmacyId]
        );
        await createNotification(
            'admin',
            `Pharmacy with ID ${pharmacyId} has been ${is_active ? 'activated' : 'deactivated'}.`,
            is_active ? 'activate_pharmacy' : 'deactivate_pharmacy',
            'admin',
            [req.user?.adminId || 'system']
        );

        res.json({
            message: `Pharmacy has been ${is_active ? 'activated' : 'deactivated'} successfully`,
            pharmacyId,
            is_active
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Update pharmacy details
exports.updatePharmacy = async (req, res) => {
    const { pharmacyId } = req.params;
    const { name, address, phone_No, username, status } = req.body;

    if (!pharmacyId) {
        return res.status(400).json({ message: 'pharmacyId is required' });
    }

    try {
        const [result] = await pool.query(
            `UPDATE pharmacy 
             SET name = ?, address = ?, phone_No = ?, username = ?, status = ?
             WHERE pharmacy_id = ?`,
            [name, address, phone_No, username, status, pharmacyId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Pharmacy not found' });
        }

        res.json({ message: 'Pharmacy updated successfully', pharmacyId });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Update wholesaler details
exports.updateWholesaler = async (req, res) => {
    const { wholesalerId } = req.params;
    const { name, address, username, status } = req.body;

    if (!wholesalerId) {
        return res.status(400).json({ message: 'wholesalerId is required' });
    }

    try {
        const [existing] = await pool.query(
            'SELECT wholesaler_id FROM wholesalers WHERE wholesaler_id = ?',
            [wholesalerId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ message: 'Wholesaler not found' });
        }

        await pool.query(
            `UPDATE wholesalers 
             SET name = ?, address = ?, username = ?, status = ?
             WHERE wholesaler_id = ?`,
            [name, address, username, status, wholesalerId]
        );

        res.json({
            message: 'Wholesaler updated successfully',
            wholesalerId,
            updatedFields: { name, address, username, status }
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Get single admin by ID (self or mainAdmin can view)
exports.getAdminById = async (req, res) => {
  const { adminId } = req.params;
  if (!adminId) return res.status(400).json({ message: 'Admin ID is required' });

  try {
    // Regular admin can only fetch their own profile
    if (!req.user.isMainAdmin && req.user.adminId !== adminId) {
      return res.status(403).json({ message: 'You can only view your own details' });
    }

    const [rows] = await pool.query(
      'SELECT admin_id, name, username, email, role, status, created_at FROM admins WHERE admin_id = ?',
      [adminId]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Admin not found' });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Update admin details (self or mainAdmin)
exports.updateAdmin = async (req, res) => {
  const { adminId } = req.params;
  const { name, email, username } = req.body;

  if (!adminId) return res.status(400).json({ message: 'Admin ID is required' });

  try {
    // Regular admin can only update themselves
    if (!req.user.isMainAdmin && req.user.adminId !== adminId) {
      return res.status(403).json({ message: 'You can only update your own profile' });
    }

    const [existing] = await pool.query('SELECT 1 FROM admins WHERE admin_id = ?', [adminId]);
    if (existing.length === 0) return res.status(404).json({ message: 'Admin not found' });

    await pool.query(
      'UPDATE admins SET name = ?, email = ?, username = ? WHERE admin_id = ?',
      [name, email, username, adminId]
    );

    res.json({ message: 'Admin updated successfully', adminId });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Change admin password (self or mainAdmin)
exports.changeAdminPassword = async (req, res) => {
  const { adminId } = req.params;
  const { currentPassword, newPassword } = req.body;

  if (!adminId || !currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Admin ID, current password, and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters' });
  }

  try {
    // Regular admin can only change their own password
    if (!req.user.isMainAdmin && req.user.adminId !== adminId) {
      return res.status(403).json({ message: 'You can only change your own password' });
    }

    const [rows] = await pool.query('SELECT password FROM admins WHERE admin_id = ?', [adminId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Admin not found' });

    const validPassword = await bcrypt.compare(currentPassword, rows[0].password);
    if (!validPassword) return res.status(401).json({ message: 'Current password is incorrect' });

    const hashedNew = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admins SET password = ? WHERE admin_id = ?', [hashedNew, adminId]);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    // Make sure you are using the correct field from the token
    const adminId = req.user.adminId; // use the exact field from your JWT payload

    // Optional: Test what rows exist for this admin without recipient_id filter
    const [allRows] = await pool.query(
      `SELECT * FROM notifications WHERE recipient_role = 'admin' ORDER BY created_at DESC`
    );

    // Actual query
    const [rows] = await pool.query(
      `SELECT notification_id, recipient_id, recipient_role, message, type, created_at, is_read, trigger_role
       FROM notifications
       WHERE recipient_role = 'admin'
         AND recipient_id = ?
       ORDER BY created_at DESC`,
      [adminId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error in getNotifications:", err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


