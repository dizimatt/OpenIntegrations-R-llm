const crypto = require('crypto');
const axios = require('axios');
const Session = require('../models/session');
const Webhook = require('../models/webhook');
const CartEvent = require('../models/cartEvent');
const { apiKey, apiSecret } = require('../config/shopify');

// Register webhooks for a shop
exports.registerWebhooks = async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const session = await Session.findOne({ shop });
    if (!session) {
      return res.status(401).json({ error: 'Shop not authenticated' });
    }

    // Define webhook topics to register
    const webhookTopics = [
      { topic: 'carts/update', address: `${process.env.APP_URL}/webhooks/carts-update` }
    ];

    const results = [];

    for (const { topic, address } of webhookTopics) {
      try {
        // Check if webhook already exists
        const existingWebhook = await Webhook.findOne({ shop, topic });
        
        if (existingWebhook) {
          results.push({ 
            topic, 
            status: 'already_registered', 
            webhookId: existingWebhook.webhookId 
          });
          continue;
        }

        // Register webhook with Shopify
        const response = await axios.post(
          `https://${shop}/admin/api/2023-10/webhooks.json`,
          {
            webhook: {
              topic,
              address,
              format: 'json'
            }
          },
          {
            headers: {
              'X-Shopify-Access-Token': session.accessToken,
              'Content-Type': 'application/json'
            }
          }
        );

        // Store webhook info in database
        if (response.data && response.data.webhook) {
          const webhookData = response.data.webhook;
          
          await Webhook.findOneAndUpdate(
            { shop, topic },
            {
              shop,
              topic,
              webhookId: webhookData.id,
              address
            },
            { upsert: true, new: true }
          );

          results.push({ 
            topic, 
            status: 'registered', 
            webhookId: webhookData.id 
          });
        }
      } catch (error) {
        console.error(`Error registering webhook ${topic} for ${shop}:`, error.message);
        results.push({ 
          topic, 
          status: 'error', 
          error: error.message 
        });
      }
    }

    res.json({ 
      success: true, 
      message: 'Webhook registration process completed',
      results 
    });
  } catch (error) {
    console.error('Webhook registration error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
};

// Handle cart update webhook
exports.cartsUpdate = async (req, res) => {
  try {
    // Verify webhook is from Shopify
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const topic = req.headers['x-shopify-topic'];
    const shop = req.headers['x-shopify-shop-domain'];

    // Return early if any required headers are missing
    if (!hmac || !topic || !shop) {
      console.error('Missing required headers in webhook request');
      return res.status(401).send('Unauthorized');
    }

    // Verify webhook signature
    const body = JSON.stringify(req.body);
    const generated_hash = crypto
      .createHmac('sha256', apiSecret)
      .update(body, 'utf8')
      .digest('base64');

    if (generated_hash !== hmac) {
      console.error('HMAC validation failed for webhook');
      return res.status(401).send('HMAC validation failed');
    }

    // At this point, we know the webhook is legitimate
    console.log(`Received cart update from ${shop}`);

    // Process cart data
    const cartData = req.body;
//    console.log('Cart data:', cartData);
    
    // Extract relevant cart information
    const cartEvent = new CartEvent({
      shop,
      cartToken: cartData.token,
      cartId: cartData.id,
      event: 'updated',
      lineItems: cartData.line_items.map(item => ({
        variantId: item.variant_id,
        productId: item.product_id,
        title: item.title,
        quantity: item.quantity,
        price: parseFloat(item.price)
      })),
      customerInfo: cartData.customer ? {
        email: cartData.customer.email,
        firstName: cartData.customer.first_name,
        lastName: cartData.customer.last_name,
        customerId: cartData.customer.id
      } : {},
      totalPrice: (cartData.total_price?parseFloat(cartData.total_price):0),
      subtotalPrice: (cartData.subtotal_price?parseFloat(cartData.subtotal_price):0),
      rawData: cartData
    });
    console.log('Cart event data: %o', cartEvent);

    await cartEvent.save();
    console.log(`Saved cart event for shop ${shop}, cart ID: ${cartData.id}`);

    // Always respond with 200 to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing cart update webhook:', error);

    // Still respond with 200 to acknowledge receipt
    // (Shopify will retry if we respond with an error code)
    res.status(200).send('Error occurred but acknowledged');
  }
};

// List webhooks registered for a shop
exports.listWebhooks = async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const webhooks = await Webhook.find({ shop });
    res.json({ webhooks });
  } catch (error) {
    console.error('Error listing webhooks:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
};

// Delete a webhook
exports.deleteWebhook = async (req, res) => {
  try {
    const { shop } = req.query;
    const { webhookId } = req.params;
    
    if (!shop || !webhookId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const session = await Session.findOne({ shop });
    if (!session) {
      return res.status(401).json({ error: 'Shop not authenticated' });
    }

    // Delete from Shopify
    await axios.delete(
      `https://${shop}/admin/api/2023-10/webhooks/${webhookId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': session.accessToken
        }
      }
    );

    // Delete from our database
    await Webhook.findOneAndDelete({ shop, webhookId });

    res.json({ 
      success: true, 
      message: `Webhook ${webhookId} deleted successfully` 
    });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
};