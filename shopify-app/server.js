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
  /*
  // removing all of this for now...
            $.get('/api/products?shop=' + shop, function(data) {
              $('#products').html('<h2>Products</h2><pre>' + JSON.stringify(data, null, 2) + '</pre>');
            }).fail(function(err) {
              console.error('API call failed:', err);
              $('#products').html('<p>Failed to load products.</p>');
            });
            
            $.get('/api/orders?shop=' + shop, function(data) {
              $('#orders').html('<h2>Orders</h2><pre>' + JSON.stringify(data, null, 2) + '</pre>');
            }).fail(function(err) {
              console.error('API call failed:', err);
              $('#orders').html('<p>Failed to load orders.</p>');
            });
  */
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Shopify Embedded App</title>
        <script src="https://cdn.jsdelivr.net/npm/jquery"></script>
      </head>
      <body>
        <h1>Shopify Embedded App</h1>
        <h2>Shop URL: ${shop}</h2>

        <div id="products">Loading products...</div>
        <div id="orders">Loading orders...</div>
        <div id="llm-test">
          <h2>LLM Test</h2>
          <input type="text" id="llm-query" placeholder="Ask something...">
          <button onclick="askLLM()">Ask LLM</button>
          <div id="llm-response"></div>
        </div>

        <script>
          const shop = '${shop}';

          $(document).ready(function() {
            if (!shop) {
              alert('Missing shop parameter');
              return;
            }

          });

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
  res.redirect(`/embedded?shop=${shop}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));