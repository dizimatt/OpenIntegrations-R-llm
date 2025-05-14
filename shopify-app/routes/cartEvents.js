const express = require('express');
const router = express.Router();
const cartEventsController = require('../controllers/cartEventsController');
const verifyRequest = require('../utils/verifyRequest');

// Routes for cart events
router.get('/', verifyRequest, cartEventsController.getCartEvents);
router.get('/adjustments-summary', verifyRequest, cartEventsController.getCartAdjustmentsSummary);
router.get('/:eventId', verifyRequest, cartEventsController.getCartEventDetails);

module.exports = router;