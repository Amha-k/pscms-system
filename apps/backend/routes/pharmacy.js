const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const pharmacyController = require('../controllers/pharmacyController');

// Public routes (no auth required)
router.post('/register', pharmacyController.register);
router.post('/login', pharmacyController.login);

// Protected routes (auth required)
router.get('/dashboard/stats', authenticateToken, pharmacyController.getDashboardStats);
router.get('/orders', authenticateToken, pharmacyController.getOrders);
router.get('/inventory', authenticateToken, pharmacyController.getInventory);
router.patch('/inventory/:productId', authenticateToken, pharmacyController.updateInventoryItem);
router.get('/inventory/:productId', authenticateToken, pharmacyController.getPharmacyInventory);
router.get('/notifications', authenticateToken, pharmacyController.getNotifications);
router.patch('/notifications/:requestId/read', authenticateToken, pharmacyController.markNotificationRead);

router.get('/me', authenticateToken, pharmacyController.getProfile);
router.put('/me', authenticateToken, pharmacyController.updateProfile);
router.put('/change-password', authenticateToken, pharmacyController.changePassword);
router.post('/google-login', pharmacyController.googleLogin);

module.exports = router;
