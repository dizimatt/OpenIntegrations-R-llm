const axios = require('axios');
const { apiVersion } = require('../config/shopify');

const shopifyGraphql = async (shop, accessToken, query) => {
  const response = await axios.post(`https://${shop}/admin/api/${apiVersion}/graphql.json`, { query }, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });
  if (response.data.errors && response.data.errors.length > 0) {
    console.error('GraphQL errors: %o', response.data.errors);
    return null;
  }

  return response.data.data;
};

module.exports = shopifyGraphql;
