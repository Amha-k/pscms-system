const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const requestController = require('../controllers/requestController');

// Pharmacy creates a new request
router.post('/', authenticateToken, requestController.createRequest);

// Pharmacy views own requests
router.get('/pharmacy', authenticateToken, requestController.getMyRequestsForPharmacy);

// Wholesaler views incoming requests
router.get('/wholesaler', authenticateToken, requestController.getIncomingRequestsForWholesaler);

// Wholesaler approves/rejects a request
router.patch('/:requestId/approve', authenticateToken, requestController.approveRequest);
router.patch('/:requestId/reject', authenticateToken, requestController.rejectRequest);
router.patch('/:requestId/cancel', authenticateToken, requestController.cancelRequest);
module.exports = router; 