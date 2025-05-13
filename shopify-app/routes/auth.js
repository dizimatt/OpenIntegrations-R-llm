const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/', authController.startAuth); 
router.get('/callback', authController.install);
router.get('/reauth', authController.startReauth); // New route for re-authentication

module.exports = router;