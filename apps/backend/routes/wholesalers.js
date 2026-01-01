const express = require('express');
const router = express.Router();
const wholesalerController = require('../controllers/wholesalerController');
const authenticateToken = require('../middleware/auth'); // use the existing JWT auth middleware

router.post('/register', wholesalerController.register);
router.post('/login', wholesalerController.login);

// New routes for frontend integration
router.get('/me', authenticateToken, wholesalerController.getProfile);
router.put('/me', authenticateToken, wholesalerController.updateProfile);
router.put('/change-password', authenticateToken, wholesalerController.changePassword);
router.get('/notifications', authenticateToken, wholesalerController.getNotifications);
module.exports = router;
