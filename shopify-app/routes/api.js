const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');
const verifyRequest = require('../utils/verifyRequest');

router.get('/products', verifyRequest, apiController.getProducts);
router.get('/orders', verifyRequest, apiController.getOrders);
router.get('/active-carts', verifyRequest, apiController.getActiveCarts);

module.exports = router;