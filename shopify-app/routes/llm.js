// routes/llm.js - Simplified version without strict shop validation
const express = require('express');
const router = express.Router();
const llmController = require('../controllers/llmController');

// Apply rate limiting to all LLM routes (if you have llmRateLimiter middleware)
// router.use(llmRateLimiter);

// POST /api/llm/chat - Chat with LLM
router.post('/chat', llmController.chatWithLLM);

// GET /api/llm/models - Get available models for a provider
router.get('/models', llmController.getModels);

// GET /api/llm/health - Health check for LLM services
router.get('/health', llmController.healthCheck);

module.exports = router;