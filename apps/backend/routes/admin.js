const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const adminController = require('../controllers/adminController');

// Public admin auth
router.post('/login', adminController.login);

// Protected admin management routes (require authentication)
router.post('/register', authenticateToken, adminController.register);
router.post('/create-admin', authenticateToken, adminController.createAdmin);
router.get('/admins', authenticateToken, adminController.getAllAdmins);
router.delete('/admins/:adminId', authenticateToken, adminController.removeAdmin);
router.post('/change-main-password', authenticateToken, adminController.changeMainAdminPassword);
router.get('/me', authenticateToken, adminController.getMe);
// Protected business management routes
router.get('/wholesalers', authenticateToken, adminController.getAllWholesalers);
router.get('/pharmacies', authenticateToken, adminController.getAllPharmacies);
router.get('/stats', authenticateToken, adminController.getDashboardStats);
router.get('/wholesalers/growth', authenticateToken, adminController.getWholesalerGrowth);
router.get('/wholesalers/:wholesalerId', authenticateToken, adminController.getWholesalerDetails);
router.get('/pharmacies/:pharmacyId', authenticateToken, adminController.getPharmacyDetails);
router.patch('/pharmacies/:pharmacyId/approve', authenticateToken, adminController.approvePharmacy);
router.patch('/pharmacies/:pharmacyId/reject', authenticateToken, adminController.rejectPharmacy);
router.patch('/wholesalers/:wholesalerId/activate', authenticateToken, adminController.toggleWholesalerActiveStatus);
router.patch('/pharmacies/:pharmacyId/activate', authenticateToken, adminController.togglePharmacyActiveStatus);
router.patch('/pharmacies/:pharmacyId', authenticateToken, adminController.updatePharmacy);
router.patch('/wholesalers/:wholesalerId', authenticateToken, adminController.updateWholesaler);

// Add in your routes file
router.get('/admin/:adminId', authenticateToken, adminController.getAdminById);
router.put('/admin/:adminId', authenticateToken, adminController.updateAdmin);
router.post('/admin/:adminId/change-password', authenticateToken, adminController.changeAdminPassword);

router.get('/notifications', authenticateToken, adminController.getNotifications);
module.exports = router; 