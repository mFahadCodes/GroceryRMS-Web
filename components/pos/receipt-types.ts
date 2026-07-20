export type ReceiptOrder = {
  orderNumber: string;
  status: string;
  createdAt: string;
  subTotal: string;
  taxAmount: string;
  discountAmount: string;
  grandTotal: string;
  cashier: {
    fullName: string | null;
    username: string;
  };
  orderItems: Array<{
    quantity: number;
    lineTotal: string;
    product: { name: string };
  }>;
  payments: Array<{
    tenderedAmount: string;
    changeAmount: string;
    paymentMethod: { name: string };
  }>;
};

export type ReceiptStoreInfo = {
  name: string;
  address: string;
  phone: string;
};

export const DEFAULT_STORE_INFO: ReceiptStoreInfo = {
  name: "My Store",
  address: "123 Main Street, Karachi",
  phone: "+92 300 1234567",
};
