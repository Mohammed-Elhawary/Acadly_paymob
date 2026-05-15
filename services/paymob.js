const axios = require("axios");

async function getAuthToken() {
  const response = await axios.post(
    "https://accept.paymob.com/api/auth/tokens",
    {
      api_key: process.env.PAYMOB_API_KEY,
    }
  );

  console.log("TOKEN RESPONSE:", response.data);

  return response.data.token;
}

async function createOrder(token, amount) {
  try {
    const response = await axios.post(
      "https://accept.paymob.com/api/ecommerce/orders",
      {
        auth_token: token,
        delivery_needed:true,
        amount_cents: Number(amount) * 100,
        currency: "EGP",
        items: [],
      }
    );

    console.log("ORDER RESPONSE:", response.data);
    return response.data.id;

  } catch (error) {
    console.log("ORDER ERROR STATUS:", error.response?.status);
    console.log("ORDER ERROR DATA:", error.response?.data);
    throw error;
  }
}
async function generatePaymentKey(token, orderId, amount) {
  const response = await axios.post(
    "https://accept.paymob.com/api/acceptance/payment_keys",
    {
      auth_token: token,
      amount_cents: Number(amount) * 100,
      expiration: 3600,
      order_id: orderId,
      currency: "EGP",
      integration_id: Number(process.env.PAYMOB_INTEGRATION_ID),

      billing_data: {
        first_name: "Test",
        last_name: "User",
        email: "test@test.com",
        phone_number: "01000000000",

        street: "Test Street",
        building: "12",
        floor: "3",
        apartment: "15",
        city: "Cairo",
        country: "EG",
        state: "Cairo",
        postal_code: "12345",
        shipping_method: "PKG"
      }
    }
  );

  return response.data.token;
}

module.exports = { getAuthToken, createOrder, generatePaymentKey };