const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const productController = require('../controllers/productController');

// Add a product (auth required)
router.post('/', authenticateToken, productController.addProduct);

// Get all products for the authenticated wholesaler
router.get('/', authenticateToken, productController.getProducts);

// Public/Pharmacy: Compare prices by product name
router.get('/compare', productController.comparePrices);

// Update a product (auth required)
router.put('/:product_id', authenticateToken, productController.updateProduct);

// Delete a product (auth required)
router.delete('/:product_id', authenticateToken, productController.deleteProduct);

module.exports = router;