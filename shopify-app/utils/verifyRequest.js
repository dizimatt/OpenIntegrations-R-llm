// shopify-app/utils/verifyRequest.js
module.exports = (req, res, next) => {
  // Check for shop parameter in query string or request body
  const shop = req.query.shop || (req.body && req.body.shop);
  
  if (!shop) {
    // For API endpoints, return JSON error
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing shop parameter'
      });
    }
    // For regular routes, send plain text error
    return res.status(401).send('Missing shop parameter');
  }
  
  // Add shop to request for downstream middleware/handlers
  req.shopify = {
    shop: shop
  };
  
  next();
};