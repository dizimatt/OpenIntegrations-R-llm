const axios = require('axios');
const { apiVersion } = require('../config/shopify');

const shopifyGraphql = async (shop, accessToken, query) => {
  try {
    const response = await axios.post(`https://${shop}/admin/api/${apiVersion}/graphql.json`, { query }, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.data.errors && response.data.errors.length > 0) {
      console.error('GraphQL errors: %o', response.data.errors);
      
      // Determine if this is an access permission issue
      const isPermissionError = response.data.errors.some(error => 
        error.message && (
          error.message.includes('access') || 
          error.message.includes('permission') ||
          error.message.includes('authorized')
        )
      );
      
      if (isPermissionError) {
        throw new Error('Permission error: The app needs additional access scopes');
      } else {
        // For other types of errors, return null
        return null;
      }
    }

    return response.data.data;
  } catch (error) {
    // Re-throw the error to be handled by the controller
    throw error;
  }
};

module.exports = shopifyGraphql;