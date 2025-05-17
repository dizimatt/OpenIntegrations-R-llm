const crypto = require('crypto');
const axios = require('axios');
const Session = require('../models/session');
const Webhook = require('../models/webhook');
const CartEvent = require('../models/cartEvent');
const { apiKey, apiSecret, apiVersion } = require('../config/shopify');

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
          `https://${shop}/admin/api/${apiVersion}/webhooks.json`,
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
    
    // Log a summary of the cart rather than the full details to avoid huge logs
    console.log(`Cart ID: ${cartData.id}, Token: ${cartData.token}, Line items: ${cartData.line_items?.length || 0}`);
    
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

        // Try to adjust cart using direct GraphQL with the Storefront API
        const adjustmentResult = await adjustCartUsingStorefrontGraphQL(shop, cartData);
        
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
              timestamp: new Date(),
              simulated: adjustmentResult.simulated
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

// Direct cart adjustment using Storefront GraphQL API with a public access token
async function adjustCartUsingStorefrontGraphQL(shop, cartData) {
  try {
    const session = await Session.findOne({ shop });
    
    
    console.log('Adjusting cart using Storefront GraphQL API with public access token');
    
    // Get the cart token from the cart data
    const cartToken = cartData.token;
    if (!cartToken) {
      console.error('Missing cart token in cart data');
      // Fall back to simulation if we don't have a token
      return await simulateCartAdjustment(cartData);
    }
    
    // Calculate total items and determine how to adjust
    const lineItems = cartData.line_items;
    const totalQuantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    
    // If the total quantity is <= 5, we don't need to adjust
    if (totalQuantity <= 5) {
      return null;
    }

    // First, try to get the cart using the Storefront API
    try {
      // We can use the public Storefront API for this shop - no special token needed
      // The public Storefront API allows cart operations with just the cart ID
      
      // Convert cart ID to a format Storefront API will accept
      // Cart IDs from REST and Storefront API may have different formats
      const cartId = cartData.id; // or may need to encode: btoa(`gid://shopify/Cart/${cartData.id}`)
      
      // Step 1: Get current cart information using getCart query
      const getCartQuery = `
        query getCarts($cartId: ID!) {
          cart(id: $cartId) {
            id
            createdAt
            updatedAt
            lines(first: 20) {
              edges {
                node {
                  id
                  quantity
                  merchandise {
                    ... on ProductVariant {
                      id
                      title
                      price {
                        amount
                        currencyCode
                      }
                      product {
                        id
                        title
                      }
                    }
                  }
                }
              }
            }
            cost {
              totalAmount {
                amount
                currencyCode
              }
              subtotalAmount {
                amount
                currencyCode
              }
            }
          }
        }
      `;
      
      try{
        const cartId_gid= `gid://shopify/Cart/${cartId}`;
        const variables = {cartId: cartId_gid};

        // Log the request details
        console.log(`Fetching cart data for ID: ${cartId_gid}`); 
        console.log(`https://${shop}/api/${apiVersion}/graphql.json`);
        console.log(`accesstoken: ${session.accessToken}`);
        console.log(`cartId: ${cartId_gid}`);
        console.log(`getCartQuery: ${getCartQuery}`);
        console.log("variables: %o", variables);

        const cartResponse = await axios.post(
          `https://${shop}/api/${apiVersion}/graphql.json`,
          {getCartQuery, variables},
          {
            headers: {
              'X-Shopify-Storefront-Access-Token': session.accessToken,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (error) {
        console.error('Error fetching cart data: %o', error.message);
        return await simulateCartAdjustment(cartData);
      }
      
      // Check if we got the cart data successfully
      if (cartResponse.data.errors) {
        console.error('GraphQL errors in getCart:', cartResponse.data.errors);
        // Fall back to simulation
        return await simulateCartAdjustment(cartData);
      }
      
      const cartInfo = cartResponse.data.data.cart;
      if (!cartInfo) {
        console.error('No cart info returned from getCart query');
        // Fall back to simulation
        return await simulateCartAdjustment(cartData);
      }
      
      console.log(`Successfully retrieved cart info for ID: ${cartId}`);
      
      // Step 2: Calculate adjustments to make
      // Sort by quantity descending so we reduce the items with highest quantity first
      const cartLines = cartInfo.lines.edges;
      const sortedLines = [...cartLines].sort((a, b) => b.node.quantity - a.node.quantity);
      
      // Calculate how many items to remove
      let totalItemsInCart = cartLines.reduce((sum, edge) => sum + edge.node.quantity, 0);
      let remainingReduction = totalItemsInCart - 5;
      let totalItemsAfter = totalItemsInCart;
      
      // Prepare updated line items and adjustments
      const updatedLines = [];
      const adjustmentDetails = [];
      
      for (const edge of sortedLines) {
        const line = edge.node;
        let newQuantity = line.quantity;
        
        // If we still need to reduce and this item has more than 1
        if (remainingReduction > 0 && line.quantity > 1) {
          // Calculate how much to reduce this item
          const maxReduction = Math.max(0, line.quantity - 1);
          const actualReduction = Math.min(maxReduction, remainingReduction);
          newQuantity = line.quantity - actualReduction;
          
          // Update tracking variables
          remainingReduction -= actualReduction;
          totalItemsAfter -= actualReduction;
          
          // Record adjustment details
          if (actualReduction > 0) {
            adjustmentDetails.push({
              title: line.merchandise?.product?.title || 'Unknown Product',
              originalQuantity: line.quantity,
              newQuantity: newQuantity,
              reduction: actualReduction
            });
          }
        }
        
        // Add to list of lines to update
        updatedLines.push({
          id: line.id,
          quantity: newQuantity
        });
      }
      
      // Step 3: Execute the cartLinesUpdate mutation
      const updateCartMutation = `
        mutation updateCartLines($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
          cartLinesUpdate(cartId: $cartId, lines: $lines) {
            cart {
              id
              lines(first: 20) {
                edges {
                  node {
                    id
                    quantity
                    merchandise {
                      ... on ProductVariant {
                        id
                        title
                        price {
                          amount
                          currencyCode
                        }
                        product {
                          id
                          title
                        }
                      }
                    }
                  }
                }
              }
              cost {
                totalAmount {
                  amount
                  currencyCode
                }
                subtotalAmount {
                  amount
                  currencyCode
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
      
      // Execute the update mutation
      try{
        const updateResponse = await axios.post(
          `https://${shop}/api/unstable/graphql.json`,
          {
            query: updateCartMutation,
            variables: {
              cartId: cartId,
              lines: updatedLines
            }
          },
          {
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (error) {
        console.error('Error updating cart lines: %o', error.message);
        // Fall back to simulation
        return await simulateCartAdjustment(cartData, adjustmentDetails, totalItemsAfter);
      }
      
      // Check for mutation errors
      if (updateResponse.data.errors) {
        console.error('GraphQL errors in updateCartLines:', updateResponse.data.errors);
        // Fall back to simulation
        return await simulateCartAdjustment(cartData, adjustmentDetails, totalItemsAfter);
      }
      
      const mutationResult = updateResponse.data.data.cartLinesUpdate;
      if (mutationResult.userErrors && mutationResult.userErrors.length > 0) {
        console.error('User errors in cartLinesUpdate:', mutationResult.userErrors);
        // Fall back to simulation
        return await simulateCartAdjustment(cartData, adjustmentDetails, totalItemsAfter);
      }
      
      // Success! Get the updated cart
      const updatedCart = mutationResult.cart;
      
      // Format line items for our database
      const formattedLineItems = updatedCart.lines.edges.map(edge => {
        const node = edge.node;
        return {
          variantId: node.merchandise?.id,
          title: node.merchandise?.product?.title || 'Unknown Product',
          quantity: node.quantity,
          price: node.merchandise?.price?.amount ? parseFloat(node.merchandise.price.amount) : 0
        };
      });
      
      // Return the result
      return {
        lineItems: formattedLineItems,
        totalPrice: parseFloat(updatedCart.cost.totalAmount.amount),
        subtotalPrice: parseFloat(updatedCart.cost.subtotalAmount.amount),
        totalItems: totalItemsAfter,
        adjustmentDetails: adjustmentDetails,
        rawData: updatedCart,
        simulated: false // This was a real update
      };
    } catch (graphqlError) {
      console.error('Error in Storefront GraphQL operation:', graphqlError.message);
      // Fall back to simulation
      return await simulateCartAdjustment(cartData);
    }
  } catch (error) {
    console.error('Error in adjustCartUsingStorefrontGraphQL:', error);
    // Fall back to simulation as a last resort
    return await simulateCartAdjustment(cartData);
  }
}

// Simulate cart adjustment (fallback if API calls fail)
async function simulateCartAdjustment(cartData, preCalculatedAdjustments = null, preCalculatedTotal = null) {
  try {
    console.log('Simulating cart adjustment');
    
    // Calculate total items and determine how to adjust
    const lineItems = cartData.line_items;
    const totalQuantity = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    
    // If the total quantity is <= 5, we don't need to adjust
    if (totalQuantity <= 5) {
      return null;
    }
    
    let adjustmentDetails;
    let totalItemsAfter;
    
    // If adjustments were pre-calculated, use those
    if (preCalculatedAdjustments && preCalculatedTotal !== null) {
      adjustmentDetails = preCalculatedAdjustments;
      totalItemsAfter = preCalculatedTotal;
    } else {
      // Otherwise calculate adjustments now
      // Sort by quantity descending
      const sortedLineItems = [...lineItems].sort((a, b) => b.quantity - a.quantity);
      
      let remainingReduction = totalQuantity - 5; // We need to reduce by this much
      totalItemsAfter = totalQuantity;
      
      adjustmentDetails = [];
      
      // Process each line item
      for (const item of sortedLineItems) {
        let newQuantity = item.quantity;
        
        // If we still need to reduce and this item has more than 1
        if (remainingReduction > 0 && item.quantity > 1) {
          // Calculate how much to reduce this item
          const maxReduction = Math.max(0, item.quantity - 1);
          const actualReduction = Math.min(maxReduction, remainingReduction);
          newQuantity = item.quantity - actualReduction;
          
          // Update our tracking variables
          remainingReduction -= actualReduction;
          totalItemsAfter -= actualReduction;
          
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
      }
    }
    
    // Create a simulated cart with adjusted items
    const simulatedCart = {
      id: cartData.id,
      token: cartData.token,
      line_items: [],
      total_price: "0.00",
      subtotal_price: "0.00"
    };
    
    let totalPrice = 0;
    let subtotalPrice = 0;
    
    // Create adjusted line items for the simulated cart
    for (const item of cartData.line_items) {
      // Find if this item was adjusted
      const adjustment = adjustmentDetails.find(adj => adj.title === item.title);
      const newQuantity = adjustment ? adjustment.newQuantity : item.quantity;
      
      // Calculate price for this line item
      const lineItemPrice = parseFloat(item.price) * newQuantity;
      
      // Add to simulated cart
      simulatedCart.line_items.push({
        id: item.id,
        title: item.title,
        variant_id: item.variant_id,
        quantity: newQuantity,
        price: item.price,
        line_price: lineItemPrice.toString()
      });
      
      // Update totals
      totalPrice += lineItemPrice;
      subtotalPrice += lineItemPrice;
    }
    
    // Set the totals on our simulated response
    simulatedCart.total_price = totalPrice.toFixed(2);
    simulatedCart.subtotal_price = subtotalPrice.toFixed(2);
    
    // Calculate new total items
    const newLineItems = simulatedCart.line_items.map(item => {
      return {
        variantId: item.variant_id,
        title: item.title,
        quantity: item.quantity,
        price: parseFloat(item.price) || 0
      };
    });
    
    // Make clear in logs that this is simulated
    console.log('Generated simulated cart adjustment (not actually updated in Shopify):');
    console.log(`Total items reduced from ${totalQuantity} to ${totalItemsAfter}`);
    
    // Return the results as if the API call had succeeded
    return {
      lineItems: newLineItems,
      totalPrice: totalPrice,
      subtotalPrice: subtotalPrice,
      totalItems: totalItemsAfter,
      adjustmentDetails: adjustmentDetails,
      rawData: simulatedCart,
      simulated: true // Flag that this was simulated, not actually adjusted
    };
  } catch (error) {
    console.error('Error in simulateCartAdjustment:', error);
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
      `https://${shop}/admin/api/${apiVersion}/webhooks/${webhookId}.json`,
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