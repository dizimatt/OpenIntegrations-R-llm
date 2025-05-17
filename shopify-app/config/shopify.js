module.exports = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecret: process.env.SHOPIFY_API_SECRET,
  scopes: 'read_products,read_orders,read_draft_orders,read_checkouts,read_customers,write_checkouts,write_products,read_content,write_content,write_orders', // Added required scopes
  apiVersion: '2024-04', // Updated to the latest version
};