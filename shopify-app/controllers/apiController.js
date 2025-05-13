const shopifyGraphql = require('../utils/shopifyGraphql');
const Session = require('../models/session');

// Shared error handling functions
const handleGraphQLResponse = (data, resourceType) => {
  // Handle null response (GraphQL errors)
  if (data === null) {
    return {
      isError: true,
      status: 500,
      response: {
        error: 'GraphQL Error',
        message: `The Shopify API returned errors when fetching ${resourceType}. Check server logs for details.`
      }
    };
  }
  
  return { isError: false, data };
};

const handleApiError = (error, resourceType, shop) => {
  console.error(`Error fetching ${resourceType}:`, error);
  
  // Check if this is a permission error
  if (error.message && (
    error.message.includes('Permission') || 
    error.message.includes('access') || 
    error.message.includes('scope')
  )) {
    return {
      status: 403,
      response: {
        error: 'Permission Denied',
        message: `This app needs additional permissions to access ${resourceType} data.`,
        action: 'reauth',
        reauth_url: `/auth/reauth?shop=${shop}`
      }
    };
  }
  
  // Default error response
  return {
    status: 500,
    response: { 
      error: 'Internal Server Error',
      message: `Failed to fetch ${resourceType}: ${error.message}`
    }
  };
};

// Main controller methods
exports.getProducts = async (req, res) => {
  const session = await Session.findOne({ shop: req.query.shop });
  if (!session) return res.status(401).send('Unauthorized');

  const query = `
    {
      products(first: 10) {
        edges {
          node {
            id
            title
            descriptionHtml
          }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql(session.shop, session.accessToken, query);
    
    // Handle potential GraphQL errors
    const result = handleGraphQLResponse(data, 'products');
    if (result.isError) {
      return res.status(result.status).json(result.response);
    }
    
    res.json(result.data);
  } catch (error) {
    const errorResponse = handleApiError(error, 'products', req.query.shop);
    res.status(errorResponse.status).json(errorResponse.response);
  }
};

exports.getOrders = async (req, res) => {
  const session = await Session.findOne({ shop: req.query.shop });
  if (!session) return res.status(401).send('Unauthorized');

  const query = `
    {
      orders(first: 10) {
        edges {
          node {
            id
            name
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              email
            }
            createdAt
          }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql(session.shop, session.accessToken, query);
    
    // Handle potential GraphQL errors
    const result = handleGraphQLResponse(data, 'orders');
    if (result.isError) {
      return res.status(result.status).json(result.response);
    }
    
    res.json(result.data);
  } catch (error) {
    const errorResponse = handleApiError(error, 'orders', req.query.shop);
    res.status(errorResponse.status).json(errorResponse.response);
  }
};

exports.getActiveCarts = async (req, res) => {
  try {
    const session = await Session.findOne({ shop: req.query.shop });
    if (!session) return res.status(401).send('Unauthorized');

    // Query for active carts - those that have been updated recently and not completed
    const query = `
      {
        checkouts(first: 20, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              completedAt
              createdAt
              updatedAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              lineItems(first: 20) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      price
                      product {
                        title
                      }
                    }
                  }
                }
              }
              customer {
                firstName
                lastName
                email
              }
              shippingAddress {
                address1
                city
                country
              }
              subtotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              webUrl
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      const data = await shopifyGraphql(session.shop, session.accessToken, query);
      
      // Handle potential GraphQL errors
      const result = handleGraphQLResponse(data, 'carts');
      if (result.isError) {
        return res.status(result.status).json(result.response);
      }
      
      // Filter to only include active carts (those that haven't been completed)
      // and were updated within the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      if (result.data && result.data.checkouts && result.data.checkouts.edges) {
        result.data.checkouts.edges = result.data.checkouts.edges.filter(edge => {
          const checkout = edge.node;
          const isNotCompleted = !checkout.completedAt;
          const updatedDate = new Date(checkout.updatedAt);
          const isRecent = updatedDate > oneDayAgo;
          
          return isNotCompleted && isRecent;
        });
      }
      
      res.json(result.data);
    } catch (error) {
      const errorResponse = handleApiError(error, 'carts', req.query.shop);
      res.status(errorResponse.status).json(errorResponse.response);
    }
  } catch (error) {
    console.error('Error in getActiveCarts outer try-catch:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message || 'An unexpected error occurred'
    });
  }
};