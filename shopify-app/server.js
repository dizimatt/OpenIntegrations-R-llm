require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const connectMongo = require('./config/mongo');
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const llmRoutes = require('./routes/llm'); // Add LLM routes

const app = express();

connectMongo();

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
}));

// Set proper headers for Shopify iframe embedding
app.use((req, res, next) => {
  const shop = req.query.shop;
  if (shop) {
    res.setHeader('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
  } else {
    res.setHeader('Content-Security-Policy', `frame-ancestors https://admin.shopify.com;`);
  }
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  next();
});

app.use(compression());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(express.static('public'));

app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/llm', llmRoutes); // Add LLM routes

app.get('/embedded', (req, res) => {
  console.log('Incoming /embedded request query:', req.query);
  const shop = req.query.shop;
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Shopify Embedded App</title>
        <script src="https://cdn.jsdelivr.net/npm/jquery"></script>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.5;
            padding: 20px;
          }
          h1 {
            color: #212b36;
          }
          h2 {
            color: #5c6ac4;
            margin-top: 30px;
          }
          .card {
            border: 1px solid #dfe3e8;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 20px;
            background-color: #ffffff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          .card-header {
            font-weight: bold;
            margin-bottom: 10px;
            border-bottom: 1px solid #dfe3e8;
            padding-bottom: 10px;
          }
          .card-body {
            padding: 5px 0;
          }
          .tag {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            margin-right: 5px;
          }
          .tag-active {
            background-color: #f4f6f8;
            color: #5c6ac4;
            border: 1px solid #5c6ac4;
          }
          .tag-paid {
            background-color: #e3f1df;
            color: #108043;
          }
          .tag-unpaid {
            background-color: #fbeae5;
            color: #de3618;
          }
          .tag-fulfilled {
            background-color: #e3f1df;
            color: #108043;
          }
          .tag-unfulfilled {
            background-color: #f9fafb;
            color: #637381;
          }
          .tag-partial {
            background-color: #f4f6f8;
            color: #212b36;
          }
          .container {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
          }
          .section {
            flex: 1;
            min-width: 300px;
          }
          .loading {
            color: #637381;
            font-style: italic;
          }
          button {
            background-color: #5c6ac4;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
          }
          button:hover {
            background-color: #202e78;
          }
          .input-group {
            margin-bottom: 15px;
          }
          input[type="text"] {
            padding: 8px;
            border: 1px solid #dfe3e8;
            border-radius: 4px;
            width: 100%;
            max-width: 300px;
          }
        </style>
      </head>
      <body>
        <h1>Shopify Embedded App Dashboard</h1>
        <h2>Shop: ${shop}</h2>

        <div class="container">
          <div class="section">
            <h2>Recent Orders</h2>
            <div id="orders" class="loading">Loading orders...</div>
          </div>
          
          <div class="section">
            <h2>Active Carts</h2>
            <div id="carts" class="loading">Loading active carts...</div>
          </div>
        </div>

        <div class="section">
          <h2>LLM Assistant</h2>
          <div class="input-group">
            <input type="text" id="llm-query" placeholder="Ask something about your store...">
            <button onclick="askLLM()">Ask AI</button>
          </div>
          <div id="llm-response" class="card"></div>
        </div>

        <script>
          const shop = '${shop}';

          $(document).ready(function() {
            if (!shop) {
              alert('Missing shop parameter');
              return;
            }

            // Fetch orders
            $.get('/api/orders?shop=' + shop, function(data) {
              displayOrders(data);
            }).fail(function(err) {
              console.error('Orders API call failed:', err);
              $('#orders').html('<p>Failed to load orders.</p>');
            });
            
            // Fetch active carts
            $.get('/api/active-carts?shop=' + shop, function(data) {
              displayActiveCarts(data);
            }).fail(function(err) {
              console.error('Active carts API call failed:', err);
              
              // Check if this is a permissions error that requires re-auth
              if (err.responseJSON && err.responseJSON.action === 'reauth') {
                $('#carts').html(
                  '<div class="card">' +
                  '<div class="card-header">Additional Permissions Required</div>' +
                  '<div class="card-body">' +
                  '<p>' + err.responseJSON.message + '</p>' +
                  '<button onclick="window.location.href=\' + err.responseJSON.reauth_url + \'">Grant Permissions</button>' +
                  '</div>' +
                  '</div>'
                );
              } else {
                $('#carts').html('<p>Failed to load active carts.</p>');
              }
            });
          });

          function displayOrders(data) {
            if (!data || !data.orders || !data.orders.edges || !data.orders.edges.length) {
              $('#orders').html('<p>No orders found.</p>');
              return;
            }

            let html = '';
            data.orders.edges.forEach(edge => {
              const order = edge.node;
              const financialStatusTag = getFinancialStatusTag(order.financialStatus);
              const fulfillmentStatusTag = getFulfillmentStatusTag(order.fulfillmentStatus);
              
              html += '<div class="card">' +
                '<div class="card-header">' +
                order.name + ' ' + 
                financialStatusTag +
                fulfillmentStatusTag +
                '</div>' +
                '<div class="card-body">' +
                '<p>Date: ' + new Date(order.createdAt).toLocaleString() + '</p>' +
                '<p>Customer: ' + (order.customer ? (order.customer.firstName + ' ' + order.customer.lastName) : 'Anonymous') + '</p>' +
                '<p>Email: ' + (order.customer ? order.customer.email : 'N/A') + '</p>' +
                '<p>Total: ' + order.totalPriceSet.shopMoney.amount + ' ' + order.totalPriceSet.shopMoney.currencyCode + '</p>' +
                '</div>' +
                '</div>';
            });

            $('#orders').html(html);
          }

          function displayActiveCarts(data) {
            if (!data || !data.checkouts || !data.checkouts.edges || !data.checkouts.edges.length) {
              $('#carts').html('<p>No active carts found.</p>');
              return;
            }

            let html = '';
            data.checkouts.edges.forEach(edge => {
              const cart = edge.node;
              
              // Calculate total items
              let totalItems = 0;
              if (cart.lineItems && cart.lineItems.edges) {
                cart.lineItems.edges.forEach(item => {
                  totalItems += item.node.quantity || 1;
                });
              }
              
              const cartCreated = new Date(cart.createdAt).toLocaleString();
              const cartUpdated = new Date(cart.updatedAt).toLocaleString();
              
              html += '<div class="card">' +
                '<div class="card-header">' +
                'Cart ID: ' + cart.id.split('/').pop() +
                '<span class="tag tag-active">Active</span>' +
                '</div>' +
                '<div class="card-body">' +
                '<p>Created: ' + cartCreated + '</p>' +
                '<p>Last activity: ' + cartUpdated + '</p>' +
                '<p>Items: ' + totalItems + ' (' + cart.lineItems.edges.length + ' unique)</p>' +
                '<p>Customer: ' + (cart.customer ? (cart.customer.firstName + ' ' + cart.customer.lastName) : 'Anonymous') + '</p>' +
                '<p>Email: ' + (cart.customer ? cart.customer.email : 'N/A') + '</p>' +
                '<p>Subtotal: ' + (cart.subtotalPriceSet ? cart.subtotalPriceSet.shopMoney.amount + ' ' + cart.subtotalPriceSet.shopMoney.currencyCode : 'N/A') + '</p>' +
                '<p>Total: ' + (cart.totalPriceSet ? cart.totalPriceSet.shopMoney.amount + ' ' + cart.totalPriceSet.shopMoney.currencyCode : 'N/A') + '</p>' +
                (cart.webUrl ? '<p><a href="' + cart.webUrl + '" target="_blank">View Cart</a></p>' : '') +
                '</div>' +
                '</div>';
            });

            if (html === '') {
              $('#carts').html('<p>No active carts found.</p>');
            } else {
              $('#carts').html(html);
            }
          }

          function getFinancialStatusTag(status) {
            if (!status) return '<span class="tag tag-unpaid">Pending</span>';
            
            switch(status.toLowerCase()) {
              case 'paid':
                return '<span class="tag tag-paid">Paid</span>';
              case 'refunded':
                return '<span class="tag tag-partial">Refunded</span>';
              case 'partially_refunded':
                return '<span class="tag tag-partial">Partially Refunded</span>';
              default:
                return '<span class="tag tag-unpaid">' + status + '</span>';
            }
          }

          function getFulfillmentStatusTag(status) {
            if (!status) return '<span class="tag tag-unfulfilled">Unfulfilled</span>';
            
            switch(status.toLowerCase()) {
              case 'fulfilled':
                return '<span class="tag tag-fulfilled">Fulfilled</span>';
              case 'partial':
                return '<span class="tag tag-partial">Partially Fulfilled</span>';
              default:
                return '<span class="tag tag-unfulfilled">' + status + '</span>';
            }
          }

          function askLLM() {
            const query = $('#llm-query').val();
            if (!query) return;

            $('#llm-response').html('Thinking...');

            $.ajax({
              url: '/api/llm/chat',
              method: 'POST',
              data: JSON.stringify({
                query: query,
                provider: 'openai', // or 'claude'
                context: {
                  systemPrompt: 'You are a helpful assistant for a Shopify store.',
                  temperature: 0.7
                },
                shop: shop
              }),
              contentType: 'application/json',
              success: function(data) {
                $('#llm-response').html('<p><strong>Response:</strong></p><p>' + data.response + '</p>');
              },
              error: function(err) {
                console.error('LLM API call failed:', err);
                $('#llm-response').html('<p>Failed to get response.</p>');
              }
            });
          }
        </script>
      </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  console.log('shop %s:', shop);
  res.redirect('/embedded?shop=' + shop);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));