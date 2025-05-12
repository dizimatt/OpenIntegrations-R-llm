// Updated controllers/llmController.js with simple fix
const axios = require('axios');

// Chat with LLM (ChatGPT or Claude)
exports.chatWithLLM = async (req, res) => {
  try {
    // Allow shop parameter to come from query or body
    const { query, provider = 'openai', model, context = {} } = req.body;
    const shop = req.query.shop || req.body.shop;

    console.log(`Received request to chatWithLLM - Query: "${query}", Provider: ${provider}`);
    
    // For development/testing: Allow requests without shop parameter
    if (!shop) {
      console.log('No shop parameter provided - this would normally be required');
      // In production, you might want to reject requests without a shop parameter
      // return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Validate required fields
    if (!query) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Query is required' 
      });
    }

    // Determine which LLM provider to use
    let response;
    switch (provider.toLowerCase()) {
      case 'openai':
        response = await chatWithOpenAI(query, model, context);
        break;
      case 'claude':
        response = await chatWithClaude(query, model, context);
        break;
      default:
        return res.status(400).json({ 
          error: 'Invalid Provider', 
          message: 'Supported providers: openai, claude' 
        });
    }

    // Return the LLM response
    res.json({
      shop,
      provider,
      model: model || 'default',
      query,
      response: response.content,
      tokens: response.tokens,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('LLM Chat Error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message || 'Failed to process LLM request'
    });
  }
};

// Chat with ChatGPT function
async function chatWithOpenAI(query, model = 'gpt-3.5-turbo', context = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const messages = [
    ...(context.systemPrompt ? [{ role: 'system', content: context.systemPrompt }] : []),
    { role: 'user', content: query }
  ];

  console.log(`Calling OpenAI with model: ${model}`);

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: model,
      messages: messages,
      temperature: context.temperature || 0.7,
      max_tokens: context.maxTokens || 500
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return {
      content: response.data.choices[0].message.content,
      tokens: {
        prompt: response.data.usage.prompt_tokens,
        completion: response.data.usage.completion_tokens,
        total: response.data.usage.total_tokens
      }
    };
  } catch (error) {
    console.error('OpenAI API Error:', error.response ? error.response.data : error.message);
    throw new Error(error.response ? `OpenAI error: ${error.response.data.error.message}` : error.message);
  }
}

// Chat with Claude function
async function chatWithClaude(query, model = 'claude-3-5-sonnet-20241022', context = {}) {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const messages = [
    { role: 'user', content: query }
  ];

  console.log(`Calling Claude with model: ${model}`);

  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: model,
      messages: messages,
      max_tokens: context.maxTokens || 500,
      temperature: context.temperature || 0.7,
      system: context.systemPrompt || undefined
    }, {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });

    return {
      content: response.data.content[0].text,
      tokens: {
        prompt: response.data.usage.input_tokens,
        completion: response.data.usage.output_tokens,
        total: response.data.usage.input_tokens + response.data.usage.output_tokens
      }
    };
  } catch (error) {
    console.error('Claude API Error:', error.response ? error.response.data : error.message);
    throw new Error(error.response ? `Claude error: ${error.response.data.error}` : error.message);
  }
}

// Get supported models for a provider
exports.getModels = async (req, res) => {
  try {
    const { provider = 'openai' } = req.query;
    
    let models;
    switch (provider.toLowerCase()) {
      case 'openai':
        models = [
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and affordable' },
          { id: 'gpt-4', name: 'GPT-4', description: 'More capable but slower' },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Latest GPT-4 model' }
        ];
        break;
      case 'claude':
        models = [
          { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fastest model' },
          { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', description: 'Balanced performance' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Most capable model' },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Latest and recommended' }
        ];
        break;
      default:
        return res.status(400).json({
          error: 'Invalid Provider',
          message: 'Supported providers: openai, claude'
        });
    }

    res.json({
      provider,
      models
    });

  } catch (error) {
    console.error('Get Models Error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to get models'
    });
  }
};

// Health check for LLM services
exports.healthCheck = async (req, res) => {
  try {
    const checks = {
      openai: !!process.env.OPENAI_API_KEY,
      claude: !!process.env.CLAUDE_API_KEY
    };

    res.json({
      status: 'healthy',
      services: checks,
      message: 'LLM module is operational'
    });

  } catch (error) {
    console.error('Health Check Error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Health check failed'
    });
  }
};