const asyncHandler = require("express-async-handler");
const pool = require("../config/db");

// Helper: Generate simple, unique product IDs
function generateProductId() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 100000); // 5-digit random
  return `PROD-${year}-${String(random).padStart(5, '0')}`;
}

// Helper: create notification only for the specific recipient(s)
const createNotification = async (recipientRole, message, type, triggerRole, specificRecipientIds = []) => {
  const insertNotification = async (recipientId) => {
    const [exists] = await pool.query(
      'SELECT 1 FROM notifications WHERE recipient_id = ? AND message = ? AND type = ? AND trigger_role = ?',
      [recipientId, message, type, triggerRole]
    );
    if (exists.length === 0) {
      await pool.query(
        'INSERT INTO notifications (notification_id, recipient_id, recipient_role, message, type, trigger_role) VALUES (?, ?, ?, ?, ?, ?)',
        [generateProductId(), recipientId, recipientRole, message, type, triggerRole]
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

// Add a new product
exports.addProduct = async (req, res) => {
  const { name, description, price, quantity, expire_date } = req.body;
  const wholesalerId = req.user.wholesalerId;

  if (!name || !price || !quantity || !expire_date)
    return res.status(400).json({ message: 'Name, price, quantity, and expire_date are required' });

  try {
    const productId = generateProductId();

    await pool.query(
      'INSERT INTO products (product_id, name, description, price, quantity, expire_date, wholesaler_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [productId, name, description, price, quantity, expire_date, wholesalerId]
    );

    await createNotification('wholesaler', `You added a new product: ${name}`, 'product', 'wholesaler', [wholesalerId]);

    res.status(201).json({ message: 'Product added successfully', productId });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Get all products
exports.getProducts = async (req, res) => {
  const wholesalerId = req.user.wholesalerId;
  try {
    const [products] = await pool.query('SELECT * FROM products WHERE wholesaler_id = ?', [wholesalerId]);
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Update a product
exports.updateProduct = async (req, res) => {
  const { product_id } = req.params;
  const { name, description, price, quantity, expire_date } = req.body;
  const wholesalerId = req.user.wholesalerId;

  if (!product_id) return res.status(400).json({ message: 'Product ID is required' });

  try {
    const [currentProduct] = await pool.query(
      'SELECT name, price FROM products WHERE product_id = ? AND wholesaler_id = ?',
      [product_id, wholesalerId]
    );

    if (currentProduct.length === 0) return res.status(404).json({ message: 'Product not found or not authorized' });

    const oldPrice = currentProduct[0].price;
    const productName = currentProduct[0].name;

    await pool.query(
      'UPDATE products SET name = ?, description = ?, price = ?, quantity = ?, expire_date = ? WHERE product_id = ? AND wholesaler_id = ?',
      [name, description, price, quantity, expire_date, product_id, wholesalerId]
    );

    // Notify the wholesaler who owns the product
    await createNotification('wholesaler', `You updated your product: ${name}`, 'product', 'wholesaler', [wholesalerId]);

    if (oldPrice !== price) {
      const [pendingRequests] = await pool.query(
        'SELECT DISTINCT pharmacy_id FROM request WHERE product_name = ? AND status = "pending"',
        [productName]
      );
      const pharmacyIds = pendingRequests.map(r => r.pharmacy_id);
      if (pharmacyIds.length > 0)
        await createNotification('pharmacy', `Price for ${productName} changed from $${oldPrice} to $${price}`, 'product', 'wholesaler', pharmacyIds);
    }

    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Delete a product
exports.deleteProduct = async (req, res) => {
  const { product_id } = req.params;
  const wholesalerId = req.user.wholesalerId;

  if (!product_id) return res.status(400).json({ message: 'Product ID is required' });

  try {
    const [products] = await pool.query(
      'SELECT * FROM products WHERE product_id = ? AND wholesaler_id = ?',
      [product_id, wholesalerId]
    );
    if (products.length === 0) return res.status(404).json({ message: 'Product not found or not authorized' });

    await pool.query('DELETE FROM products WHERE product_id = ? AND wholesaler_id = ?', [product_id, wholesalerId]);

    // Notify the wholesaler who owned the product
    await createNotification('wholesaler', `You deleted your product: ${products[0].name}`, 'product', 'wholesaler', [wholesalerId]);

    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Compare prices
exports.comparePrices = async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ message: 'Query parameter "name" is required' });

  try {
    const [rows] = await pool.query(
      `SELECT 
         p.product_id,
         p.name AS product_name,
         p.description,
         p.price,
         p.quantity,
         p.expire_date,
         w.wholesaler_id,
         w.name AS wholesaler_name,
         w.address AS wholesaler_address,
         w.status AS wholesaler_status
       FROM products p
       JOIN wholesalers w ON w.wholesaler_id = p.wholesaler_id
       WHERE p.name LIKE ?
       ORDER BY p.price ASC`,
      [`%${name}%`]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
