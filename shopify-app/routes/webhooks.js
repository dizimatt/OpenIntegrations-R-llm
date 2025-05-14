const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const verifyRequest = require('../utils/verifyRequest');

// Routes that require shop authentication
router.get('/register', verifyRequest, webhookController.registerWebhooks);
router.get('/list', verifyRequest, webhookController.listWebhooks);
router.delete('/:webhookId', verifyRequest, webhookController.deleteWebhook);

// Webhook receiver endpoints - these don't use verifyRequest as they're called by Shopify
router.post('/carts-update', express.json({type: 'application/json'}), webhookController.cartsUpdate);

module.exports = router;