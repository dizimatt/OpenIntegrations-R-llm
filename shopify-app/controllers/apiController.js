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

    // Query for active carts using draftOrders (since checkouts is no longer available)
    const query = `
      {
        draftOrders(first: 20, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              createdAt
              updatedAt
              totalPrice
              subtotalPrice
              currencyCode
              customer {
                firstName
                lastName
                email
              }
              lineItems(first: 20) {
                edges {
                  node {
                    title
                    quantity
                    originalUnitPrice
                    variant {
                      title
                      price
                      product {
                        title
                      }
                    }
                  }
                }
              }
              shippingAddress {
                address1
                city
                country
              }
              status
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
      
      // Filter to only include active draft orders
      // (those that were updated within the last 7 days)
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      
      if (result.data && result.data.draftOrders && result.data.draftOrders.edges) {
        result.data.draftOrders.edges = result.data.draftOrders.edges.filter(edge => {
          const draftOrder = edge.node;
          const updatedDate = new Date(draftOrder.updatedAt);
          const isRecent = updatedDate > oneWeekAgo;
          
          // Consider it active if it's recent and not completed/archived
          return isRecent && draftOrder.status !== 'COMPLETED';
        });
      }
      
      // Rename the response field from draftOrders to carts for frontend compatibility
      if (result.data && result.data.draftOrders) {
        result.data.carts = result.data.draftOrders;
        delete result.data.draftOrders;
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