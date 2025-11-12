const { createHandler } = require('@app-core/server');
const parseInstruction = require('@app/services/payment-processor/parse-instruction');

module.exports = createHandler({
  // Step 1: Define the route
  path: '/payment-instructions',
  method: 'post', // 'get', 'post', 'put', 'patch', 'delete'

  // Step 2: Add middlewares (optional)
  middlewares: [], // Empty for no middleware

  // Step 3: Define props (optional)
  props: {
    // Custom properties accessible in middleware/handler
    // Example: ACL: { requiresAuth: false }
  },

  // Step 4: Define the handler
  async handler(rc, helpers) {
    // rc = request context
    // rc.body = POST/PUT/PATCH payload
    // rc.query = GET query parameters
    // rc.params = URL path parameters
    // rc.headers = HTTP headers
    // rc.meta = Data added by middleware

    // Step 5: Prepare service payload
    const payload = {
      ...rc.body, // For POST/PUT/PATCH
      // ...rc.query, // For GET
      // ...rc.params, // For path params like /resource/:id
    };

    // Step 6: Call your service
    const response = await parseInstruction(payload);

    // Step 7: Return response
    return {
      status: helpers.http_statuses.HTTP_200_OK,
      message: 'Instruction processed successfully', // Optional
      data: response,
    };
  },
});
