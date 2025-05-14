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
      totalPrice: (cartData.total_price ? parseFloat(cartData.total_price) : 0),
      subtotalPrice: (cartData.subtotal_price ? parseFloat(cartData.subtotal_price) : 0),
      rawData: cartData
    });

    // Save the cart event to the database
    await cartEvent.save();
    console.log(`Saved cart event for shop ${shop}, cart ID: ${cartData.id}`);

    // Check if cart has more than 5 total items
    let totalItems = 0;
    cartData.line_items.forEach(item => {
      totalItems += item.quantity;
    });

    console.log(`Cart ${cartData.id} has ${totalItems} total items`);

    // If cart has more than 5 items, adjust it
    if (totalItems > 5) {
      console.log(`Cart ${cartData.id} exceeds 5 items, adjusting quantities...`);
      
      try {
        // Find the shop's access token to make the API call
        const session = await Session.findOne({ shop });
        if (!session || !session.accessToken) {
          console.error(`No session found for shop ${shop}, cannot adjust cart`);
          return res.status(200).send('OK');
        }

        // Adjust the cart using GraphQL mutation
        const adjustmentResult = await adjustCartItems(shop, session.accessToken, cartData);
        
        // Record the adjustment in a new cart event
        if (adjustmentResult) {
          const adjustmentEvent = new CartEvent({
            shop,
            cartToken: cartData.token,
            cartId: cartData.id,
            event: 'system_adjusted',
            lineItems: adjustmentResult.lineItems,
            customerInfo: cartEvent.customerInfo,
            totalPrice: adjustmentResult.totalPrice,
            subtotalPrice: adjustmentResult.subtotalPrice,
            mutationInfo: {
              reason: 'exceeded_item_limit',
              itemsBefore: totalItems,
              itemsAfter: adjustmentResult.totalItems,
              adjustmentDetails: adjustmentResult.adjustmentDetails,
              timestamp: new Date()
            },
            rawData: adjustmentResult.rawData
          });
          
          await adjustmentEvent.save();
          console.log(`Saved adjustment event for cart ${cartData.id}`);
        }
      } catch (adjustError) {
        console.error('Error adjusting cart:', adjustError);
        // Continue processing - we still want to acknowledge the webhook
      }
    }

    // Always respond with 200 to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing cart update webhook:', error);

    // Still respond with 200 to acknowledge receipt
    res.status(200).send('Error occurred but acknowledged');
  }
};

// Function to adjust cart items via GraphQL
async function adjustCartItems(shop, accessToken, cartData) {
  try {
    // For draft orders, we need to use the correct format without line item IDs
    // and using variant IDs instead
    
    // Get the draft order ID
    const draftOrderId = cartData.id;
    
    // Calculate total items and determine how to adjust
    const lineItems = cartData.line_items;
    const totalQuantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    
    // If the total quantity is > 5, we need to reduce
    if (totalQuantity <= 5) {
      return null; // No adjustment needed
    }
    
    // We'll keep track of adjustments for reporting
    const adjustmentDetails = [];
    
    // First, we'll try to find the draft order from Shopify to get its GraphQL ID
    const draftOrderQuery = `
      query getDraftOrder($id: ID!) {
        draftOrder(id: $id) {
          id
          name
        }
      }
    `;
    
    // For REST API ID to GraphQL ID conversion
    const gid = `gid://shopify/DraftOrder/${draftOrderId}`;
    
    // Get the draft order info
    const draftOrderResponse = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { 
        query: draftOrderQuery,
        variables: { id: gid }
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check if we got the draft order
    if (!draftOrderResponse.data.data.draftOrder) {
      console.error('Draft order not found:', draftOrderId);
      return null;
    }
    
    // Now prepare the adjusted line items for the mutation
    const adjustedLineItems = [];
    
    // Use a more sophisticated algorithm to determine which items to adjust
    // Sort by quantity descending so we reduce the items with highest quantity first
    const sortedLineItems = [...lineItems].sort((a, b) => b.quantity - a.quantity);
    
    let remainingReduction = totalQuantity - 5; // We need to reduce by this much
    let adjustedTotalQuantity = totalQuantity;
    
    for (const item of sortedLineItems) {
      // If we've reduced enough, keep the remaining items as is
      if (remainingReduction <= 0) {
        adjustedLineItems.push({
          variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
          quantity: item.quantity
        });
        continue;
      }
      
      // Calculate how much to reduce this item
      // We'll reduce by at most item.quantity - 1 to keep at least 1 of each item
      const maxReduction = Math.max(0, item.quantity - 1);
      const actualReduction = Math.min(maxReduction, remainingReduction);
      const newQuantity = item.quantity - actualReduction;
      
      // Update our tracking variables
      remainingReduction -= actualReduction;
      adjustedTotalQuantity -= actualReduction;
      
      // Add to our adjusted line items
      adjustedLineItems.push({
        variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
        quantity: newQuantity
      });
      
      // Record this adjustment for reporting
      if (actualReduction > 0) {
        adjustmentDetails.push({
          title: item.title,
          originalQuantity: item.quantity,
          newQuantity: newQuantity,
          reduction: actualReduction
        });
      }
    }
    
    // GraphQL mutation to update the draft order
    const mutation = `
      mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder {
            id
            name
            totalPrice
            subtotalPrice
            lineItems(first: 20) {
              edges {
                node {
                  id
                  title
                  quantity
                  variant {
                    id
                    price
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    // Execute the mutation with the correct input format
    const mutationResponse = await axios.post(
      `https://${shop}/admin/api/2023-10/graphql.json`,
      { 
        query: mutation, 
        variables: {
          id: gid,
          input: {
            lineItems: adjustedLineItems
          }
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Check for mutation errors
    if (mutationResponse.data.errors || 
        (mutationResponse.data.data && 
         mutationResponse.data.data.draftOrderUpdate.userErrors && 
         mutationResponse.data.data.draftOrderUpdate.userErrors.length > 0)) {
      console.error('GraphQL errors:', 
        mutationResponse.data.errors || mutationResponse.data.data.draftOrderUpdate.userErrors);
      return null;
    }
    
    // Get the updated draft order
    const updatedDraftOrder = mutationResponse.data.data.draftOrderUpdate.draftOrder;
    
    // Calculate new total items
    let newTotalItems = 0;
    const newLineItems = updatedDraftOrder.lineItems.edges.map(edge => {
      const node = edge.node;
      newTotalItems += node.quantity;
      return {
        variantId: node.variant?.id,
        title: node.title,
        quantity: node.quantity,
        price: node.variant?.price || 0
      };
    });
    
    // Return the results
    return {
      lineItems: newLineItems,
      totalPrice: parseFloat(updatedDraftOrder.totalPrice || 0),
      subtotalPrice: parseFloat(updatedDraftOrder.subtotalPrice || 0),
      totalItems: newTotalItems,
      adjustmentDetails: adjustmentDetails,
      rawData: updatedDraftOrder
    };
  } catch (error) {
    console.error('Error in adjustCartItems:', error);
    if (error.response && error.response.data) {
      console.error('API response:', error.response.data);
    }
    throw error;
  }
}

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