module.exports = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecret: process.env.SHOPIFY_API_SECRET,
  scopes: 'read_products,read_orders,read_checkouts,read_customers', // Added read_checkouts
  apiVersion: '2023-10',
};