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
          }
        }
      }
    }
  `;

  const data = await shopifyGraphql(session.shop, session.accessToken, query);
  res.json(data);
};
