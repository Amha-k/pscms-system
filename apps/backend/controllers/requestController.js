const pool = require('../config/db');
const crypto = require('crypto');

// Short ID generator: PREFIX-YYYY-XXXX (XXXX = 4 hex chars)
const generateId = (prefix) => {
  const year = new Date().getFullYear();
  const short = crypto.randomBytes(2).toString('hex').toUpperCase(); // ~65k combos per year/prefix
  return `${prefix}-${year}-${short}`;
};

// 🔔 Helper: create notification (same as product controller)
const createNotification = async (recipientRole, message, type, triggerRole, specificRecipientIds = []) => {
  const insertNotification = async (recipientId) => {
    const [exists] = await pool.query(
      'SELECT 1 FROM notifications WHERE recipient_id = ? AND message = ? AND type = ? AND trigger_role = ?',
      [recipientId, message, type, triggerRole]
    );
    if (exists.length === 0) {
      await pool.query(
        'INSERT INTO notifications (notification_id, recipient_id, recipient_role, message, type, trigger_role) VALUES (?, ?, ?, ?, ?, ?)',
        [generateId('NTF'), recipientId, recipientRole, message, type, triggerRole]
      );
    }
  };

  if (specificRecipientIds.length > 0) {
    const uniqueIds = [...new Set(specificRecipientIds)];
    for (const id of uniqueIds) {
      await insertNotification(id);
    }
  }
};

// Create a new request from an authenticated pharmacy
exports.createRequest = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  let { product_name, quantity, wholesaler_id } = req.body;

  if (!pharmacyId) {
    return res.status(403).json({ message: 'Only pharmacies can create requests' });
  }
  if (!product_name || !quantity || !wholesaler_id) {
    return res.status(400).json({ message: 'Product name, quantity, and wholesaler ID are required' });
  }

  try {
    // Validate that the product exists for the specified wholesaler and get its price
    const [productRows] = await pool.query(
      'SELECT price FROM products WHERE name = ? AND wholesaler_id = ? LIMIT 1',
      [product_name, wholesaler_id]
    );
    if (productRows.length === 0) {
      return res.status(400).json({ message: 'Product not found for this wholesaler' });
    }
    const price = productRows[0].price;
    const total_amount = price * quantity;

    const requestId = generateId('REQ');
    await pool.query(
      `INSERT INTO request 
        (request_id, product_name, quantity, total_amount, order_date, request_datetime, status, pharmacy_id, wholesaler_id) 
       VALUES (?, ?, ?, ?, CURRENT_DATE, NOW(), ?, ?, ?)`,
      [requestId, product_name, quantity, total_amount, 'Pending', pharmacyId, wholesaler_id]
    );

    // 🔔 Notify wholesaler that a pharmacy created a request
    await createNotification(
      'wholesaler',
      `New request for ${quantity} units of ${product_name}`,
      'request',
      'pharmacy',
      [wholesaler_id]
    );

    return res.status(201).json({
      message: 'Request created successfully',
      requestId,
      pharmacyId,
      wholesalerId: wholesaler_id,
      productName: product_name,
      quantity,
      total_amount
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// List requests for authenticated pharmacy (all statuses)
exports.getMyRequestsForPharmacy = async (req, res) => {
  const pharmacyId = req.user && req.user.pharmacyId;
  if (!pharmacyId) {
    return res.status(403).json({ message: 'Only pharmacies can view their requests' });
  }
  try {
    const [rows] = await pool.query(
      `SELECT r.request_id AS id,
              r.product_name,
              r.quantity,
              r.order_date,
              r.request_datetime,
              r.approved_datetime,
              r.status,
              r.wholesaler_id,
              r.order_id
       FROM request r
       WHERE r.pharmacy_id = ? AND r.status != 'notification'
       ORDER BY r.order_date DESC`,
      [pharmacyId]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};


// List incoming requests for authenticated wholesaler
exports.getIncomingRequestsForWholesaler = async (req, res) => {
  const wholesalerId = req.user && req.user.wholesalerId;
  if (!wholesalerId) {
    return res.status(403).json({ message: 'Only wholesalers can view incoming requests' });
  }
  try {
    const [rows] = await pool.query(
      `SELECT r.request_id AS id,
              r.product_name,
              r.quantity,
              r.total_amount,
              r.order_date,
              r.status,
              r.pharmacy_id,
              p.name AS pharmacy_name
       FROM request r
       JOIN pharmacy p ON r.pharmacy_id = p.pharmacy_id
       WHERE r.wholesaler_id = ?
       ORDER BY r.order_date DESC`,
      [wholesalerId]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};


// Approve a request
exports.approveRequest = async (req, res) => {
  const wholesalerId = req.user && req.user.wholesalerId;
  const { requestId } = req.params;
  if (!wholesalerId) {
    return res.status(403).json({ message: 'Only wholesalers can approve requests' });
  }

  try {
    const orderId = generateId('ORD');

    // Get request details
    const [requestDetails] = await pool.query(
      'SELECT product_name, quantity, pharmacy_id, total_amount FROM request WHERE request_id = ?',
      [requestId]
    );
    if (requestDetails.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const { product_name, quantity, pharmacy_id, total_amount } = requestDetails[0];

    const pharmacyMessage = `Your request for ${quantity} units of ${product_name} (Total: ${total_amount}) has been approved. Order ID: ${orderId}`;
    const wholesalerMessage = `You approved a request for ${quantity} units of ${product_name} (Total: ${total_amount}) for pharmacy ${pharmacy_id}.`;

    // Update request status + approved date/time
    const [result] = await pool.query(
      "UPDATE request SET status = 'Approved', order_id = ?, approved_datetime = NOW(), notification_sent = FALSE, notification_message = ? WHERE request_id = ? AND wholesaler_id = ?",
      [orderId, pharmacyMessage, requestId, wholesalerId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Request not found or not authorized' });
    }

    // 🔔 Notify pharmacy
    await createNotification(
      'pharmacy',
      pharmacyMessage,
      'requestApproved',
      'wholesaler',
      [pharmacy_id]
    );

    // 🔔 Notify wholesaler
    await createNotification(
      'wholesaler',
      wholesalerMessage,
      'requestApproved',
      'wholesaler',
      [wholesalerId]
    );

    // --- NEW: Update pharmacy_inventory ---
    // 1. Get product_id from products table
    const [productRows] = await pool.query(
      'SELECT product_id FROM products WHERE name = ? AND wholesaler_id = ?',
      [product_name, wholesalerId]
    );
    if (productRows.length > 0) {
      const productId = productRows[0].product_id;

      // 2. Insert or update pharmacy_inventory
      await pool.query(
        `INSERT INTO pharmacy_inventory (pharmacy_id, product_id, quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_updated = NOW()`,
        [pharmacy_id, productId, quantity]
      );
    }
    // --- END NEW CODE ---

    return res.json({ message: 'Request approved successfully', requestId, orderId, total_amount });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Wholesaler rejects a request
exports.rejectRequest = async (req, res) => {
  const wholesalerId = req.user && req.user.wholesalerId;
  const { requestId } = req.params;
  if (!wholesalerId) {
    return res.status(403).json({ message: 'Only wholesalers can reject requests' });
  }
  try {
    const [requestDetails] = await pool.query(
      'SELECT product_name, quantity, pharmacy_id, total_amount FROM request WHERE request_id = ?',
      [requestId]
    );
    if (requestDetails.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const { product_name, quantity, pharmacy_id, total_amount } = requestDetails[0];
    const pharmacyMessage = `Your request for ${quantity} units of ${product_name} (Total: ${total_amount}) has been rejected.`;
    const wholesalerMessage = `You rejected a request for ${quantity} units of ${product_name} (Total: ${total_amount}) for pharmacy ${pharmacy_id}.`;

    const [result] = await pool.query(
      "UPDATE request SET status = 'Rejected', notification_sent = FALSE, notification_message = ? WHERE request_id = ? AND wholesaler_id = ?",
      [pharmacyMessage, requestId, wholesalerId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Request not found or not authorized' });
    }

    // 🔔 Notify pharmacy
    await createNotification(
      'pharmacy',
      pharmacyMessage,
      'requestRejected',
      'wholesaler',
      [pharmacy_id]
    );

    // 🔔 Notify wholesaler
    await createNotification(
      'wholesaler',
      wholesalerMessage,
      'requestRejected',
      'wholesaler',
      [wholesalerId]
    );

    return res.json({ message: 'Request rejected successfully', requestId, total_amount });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};
// Wholesaler cancels a request (revert to Pending)
exports.cancelRequest = async (req, res) => {
  const wholesalerId = req.user && req.user.wholesalerId;
  const { requestId } = req.params;

  if (!wholesalerId) {
    return res.status(403).json({ message: 'Only wholesalers can cancel requests' });
  }

  try {
    const [requestDetails] = await pool.query(
      'SELECT product_name, quantity, pharmacy_id, total_amount FROM request WHERE request_id = ?',
      [requestId]
    );
    if (requestDetails.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Reset to Pending state
    const [result] = await pool.query(
      `UPDATE request 
       SET status = 'Pending', 
           order_id = NULL, 
           approved_datetime = NULL, 
           notification_sent = FALSE, 
           notification_message = NULL 
       WHERE request_id = ? AND wholesaler_id = ?`,
      [requestId, wholesalerId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Request not found or not authorized' });
    }

    return res.json({
      message: 'Request canceled successfully',
      requestId,
      total_amount: requestDetails[0].total_amount
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};


