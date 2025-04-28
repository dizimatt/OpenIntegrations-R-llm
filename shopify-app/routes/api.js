const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');
const verifyRequest = require('../utils/verifyRequest');

router.get('/products', verifyRequest, apiController.getProducts);
router.get('/orders', verifyRequest, apiController.getOrders);

module.exports = router;
