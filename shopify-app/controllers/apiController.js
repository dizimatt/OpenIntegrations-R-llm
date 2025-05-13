const shopifyGraphql = require('../utils/shopifyGraphql');
const Session = require('../models/session');

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

  const data = await shopifyGraphql(session.shop, session.accessToken, query);
  res.json(data);
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
          }
        }
      }
    }
  `;

  const data = await shopifyGraphql(session.shop, session.accessToken, query);
  console.log('Orders data:', data);
  res.json(data);
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
      console.log('Active carts data: %o', data);
      
      // Filter to only include active carts (those that haven't been completed)
      // and were updated within the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      if (data && data.checkouts && data.checkouts.edges) {
        data.checkouts.edges = data.checkouts.edges.filter(edge => {
          const checkout = edge.node;
          const isNotCompleted = !checkout.completedAt;
          const updatedDate = new Date(checkout.updatedAt);
          const isRecent = updatedDate > oneDayAgo;
          
          return isNotCompleted && isRecent;
        });
      }
      
      res.json(data);
    } catch (error) {
      // Check if this is a permission error
      if (error.response && 
          (error.response.data?.errors?.some(e => e.message?.includes('access')) || 
           error.message?.includes('access') || 
           error.message?.includes('permission'))) {
        
        console.error('Permission error - app may need re-authentication:', error.message);
        return res.status(403).json({
          error: 'Permission Denied',
          message: 'This app needs additional permissions to access checkout data.',
          action: 'reauth',
          reauth_url: `/auth/reauth?shop=${req.query.shop}`
        });
      }
      
      throw error; // Re-throw for the outer catch block
    }
  } catch (error) {
    console.error('Error fetching active carts:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message || 'Failed to fetch active carts' 
    });
  }
};