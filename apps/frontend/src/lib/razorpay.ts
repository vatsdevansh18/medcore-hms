/**
 * Razorpay's hosted checkout (UPI/Netbanking) runs from their script; the
 * order was created server-side for the server-computed balance. Payment
 * success is never taken from this handler: the signed webhook settles it
 * (docs/03-ARCHITECTURE.md §9), and the page only polls the invoice.
 */

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  handler: () => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

interface RazorpayInstance {
  open(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("The UPI / Netbanking checkout couldn't be loaded. Check your connection and try again."));
    };
    document.body.appendChild(script);
  });
  return loading;
}

export async function openRazorpayCheckout(options: Omit<RazorpayOptions, "amount"> & { amount: string }): Promise<void> {
  await loadScript();
  if (!window.Razorpay) throw new Error("The UPI / Netbanking checkout isn't available right now.");
  // Razorpay takes the smallest currency unit (paise).
  const amount = Math.round(Number(options.amount) * 100);
  new window.Razorpay({ ...options, amount }).open();
}
