const paypal = require('@paypal/checkout-server-sdk');

function getPaypalMode() {
  return (process.env.PAYPAL_MODE || 'sandbox').toLowerCase() === 'live'
    ? 'live'
    : 'sandbox';
}

function getPaypalEnvironment() {
  const clientId = process.env.PAYPAL_CLIENT_ID || process.env.ClientID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || process.env.secret;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env'
    );
  }

  const mode = getPaypalMode();

  return mode === 'live'
    ? new paypal.core.LiveEnvironment(clientId, clientSecret)
    : new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

function getPaypalClient() {
  const environment = getPaypalEnvironment();
  // You can pass custom timeouts/retries here if needed.
  return new paypal.core.PayPalHttpClient(environment);
}

function getPaypalApiBaseUrl() {
  return getPaypalMode() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPaypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID || process.env.ClientID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || process.env.secret;

  if (!clientId || !clientSecret) {
    throw new Error('Missing PayPal credentials');
  }

  const response = await fetch(`${getPaypalApiBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get PayPal access token: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  if (!json?.access_token) {
    throw new Error('PayPal access token missing in response');
  }

  return json.access_token;
}

async function createPaypalPayout(payload) {
  const accessToken = await getPaypalAccessToken();
  const response = await fetch(`${getPaypalApiBaseUrl()}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal payout failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

module.exports = {
  getPaypalClient,
  getPaypalApiBaseUrl,
  getPaypalAccessToken,
  createPaypalPayout,
};
