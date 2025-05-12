// utils/llmUtils.js
const rateLimit = require('express-rate-limit');

// Rate limiting middleware for LLM endpoints
exports.llmRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per windowMs
  message: {
    error: 'Too Many Requests',
    message: 'Too many LLM requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validate API keys
exports.validateApiKeys = (req, res, next) => {
  const { provider = 'openai' } = req.body;
  
  switch (provider.toLowerCase()) {
    case 'openai':
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'OpenAI API key not configured'
        });
      }
      break;
    case 'claude':
      if (!process.env.CLAUDE_API_KEY) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Claude API key not configured'
        });
      }
      break;
    default:
      return res.status(400).json({
        error: 'Invalid Provider',
        message: 'Supported providers: openai, claude'
      });
  }
  
  next();
};

// Sanitize user input
exports.sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') return '';
  
  // Remove any potential script tags or malicious content
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .trim()
    .slice(0, 4000); // Limit length to prevent excessive token usage
};

// Format LLM response for consistent output
exports.formatLLMResponse = (response, metadata = {}) => {
  return {
    success: true,
    timestamp: new Date().toISOString(),
    metadata: {
      provider: metadata.provider || 'unknown',
      model: metadata.model || 'default',
      tokens: metadata.tokens || null,
      ...metadata
    },
    content: response,
  };
};

// Error handler middleware for LLM routes
exports.llmErrorHandler = (err, req, res, next) => {
  console.error('LLM Error:', err);
  
  // Handle specific error types
  if (err.response?.status === 401) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key for LLM provider'
    });
  }
  
  if (err.response?.status === 429) {
    return res.status(429).json({
      error: 'Rate Limited',
      message: 'LLM provider rate limit exceeded'
    });
  }
  
  if (err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Cannot connect to LLM provider'
    });
  }
  
  // Default error response
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred'
  });
};