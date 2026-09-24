/**
 * Webhook secrets for the billing e2e spec. This must be imported before
 * `AppModule`: `ConfigModule.forRoot` validates and snapshots the environment
 * when the module is first imported, so setting these in `beforeAll` would
 * be too late. They're throwaway test values, never real provider secrets
 * (SEC-PAY-004).
 */
export const TEST_STRIPE_WEBHOOK_SECRET = "whsec_medcore_e2e_test_secret";
export const TEST_RAZORPAY_WEBHOOK_SECRET = "rzp_medcore_e2e_test_secret";

process.env.STRIPE_WEBHOOK_SECRET = TEST_STRIPE_WEBHOOK_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_RAZORPAY_WEBHOOK_SECRET;
