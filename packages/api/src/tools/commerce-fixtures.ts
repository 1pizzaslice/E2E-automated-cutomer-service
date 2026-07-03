/**
 * Mock commerce data backing the first-party lookup and calculator tools. Real
 * connectors (Shopify, carrier APIs, billing) are a V2 concern; Milestone 8
 * ships deterministic in-memory fixtures so the tool registry, its permission
 * and audit machinery, and the eligibility policies can be exercised end-to-end.
 *
 * Every record is tenant-scoped. Tools filter by the caller's tenant id, so a
 * tenant can never read another tenant's order, shipment, or customer through a
 * tool — the same isolation guarantee the DB enforces via RLS.
 */

export type MockOrderStatus =
  | "created"
  | "paid"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export type MockShipmentStatus =
  | "not_shipped"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

export interface MockOrderItem {
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface MockShipmentEvent {
  readonly at: string;
  readonly status: string;
  readonly location: string;
}

export interface MockShipment {
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly status: MockShipmentStatus;
  readonly estimatedDelivery: string | null;
  readonly deliveredAt: string | null;
  readonly events: readonly MockShipmentEvent[];
}

export interface MockOrder {
  readonly orderId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly status: MockOrderStatus;
  readonly currency: string;
  readonly placedAt: string;
  readonly totalCents: number;
  readonly items: readonly MockOrderItem[];
  readonly shipment: MockShipment;
}

export interface MockCustomer {
  readonly customerId: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly email: string;
  readonly tier: "standard" | "priority" | "vip";
  readonly lifetimeOrders: number;
  readonly createdAt: string;
}

/** Read boundary the tools use so the sample data can be swapped in tests. */
export interface MockCommerceDataset {
  findOrder(tenantId: string, orderId: string): MockOrder | null;
  findOrderByTracking(
    tenantId: string,
    trackingNumber: string,
  ): MockOrder | null;
  findCustomer(tenantId: string, customerId: string): MockCustomer | null;
}

export function createCommerceDataset(
  orders: readonly MockOrder[],
  customers: readonly MockCustomer[],
): MockCommerceDataset {
  return {
    findOrder(tenantId, orderId) {
      return (
        orders.find(
          (order) => order.tenantId === tenantId && order.orderId === orderId,
        ) ?? null
      );
    },
    findOrderByTracking(tenantId, trackingNumber) {
      return (
        orders.find(
          (order) =>
            order.tenantId === tenantId &&
            order.shipment.trackingNumber === trackingNumber,
        ) ?? null
      );
    },
    findCustomer(tenantId, customerId) {
      return (
        customers.find(
          (customer) =>
            customer.tenantId === tenantId &&
            customer.customerId === customerId,
        ) ?? null
      );
    },
  };
}

const SAMPLE_ORDERS: readonly MockOrder[] = [
  {
    orderId: "ord_1001",
    tenantId: "ten_acme",
    customerId: "cus_ada",
    status: "delivered",
    currency: "USD",
    placedAt: "2026-06-01T10:00:00.000Z",
    totalCents: 8900,
    items: [
      { sku: "SKU-TEE", name: "Cotton Tee", quantity: 2, unitPriceCents: 2500 },
      { sku: "SKU-CAP", name: "Logo Cap", quantity: 1, unitPriceCents: 3900 },
    ],
    shipment: {
      carrier: "UPS",
      trackingNumber: "1Z999AA10123456784",
      status: "delivered",
      estimatedDelivery: "2026-06-05T00:00:00.000Z",
      deliveredAt: "2026-06-04T18:32:00.000Z",
      events: [
        {
          at: "2026-06-02T09:00:00.000Z",
          status: "in_transit",
          location: "Newark, NJ",
        },
        {
          at: "2026-06-04T08:00:00.000Z",
          status: "out_for_delivery",
          location: "Brooklyn, NY",
        },
        {
          at: "2026-06-04T18:32:00.000Z",
          status: "delivered",
          location: "Brooklyn, NY",
        },
      ],
    },
  },
  {
    orderId: "ord_1002",
    tenantId: "ten_acme",
    customerId: "cus_ada",
    status: "paid",
    currency: "USD",
    placedAt: "2026-07-01T14:20:00.000Z",
    totalCents: 4500,
    items: [
      {
        sku: "SKU-MUG",
        name: "Ceramic Mug",
        quantity: 3,
        unitPriceCents: 1500,
      },
    ],
    shipment: {
      carrier: null,
      trackingNumber: null,
      status: "not_shipped",
      estimatedDelivery: null,
      deliveredAt: null,
      events: [],
    },
  },
  {
    orderId: "ord_2001",
    tenantId: "ten_globex",
    customerId: "cus_bob",
    status: "shipped",
    currency: "EUR",
    placedAt: "2026-06-28T08:00:00.000Z",
    totalCents: 12000,
    items: [
      {
        sku: "SKU-KIT",
        name: "Starter Kit",
        quantity: 1,
        unitPriceCents: 12000,
      },
    ],
    shipment: {
      carrier: "DHL",
      trackingNumber: "JD0002123456789",
      status: "in_transit",
      estimatedDelivery: "2026-07-06T00:00:00.000Z",
      deliveredAt: null,
      events: [
        {
          at: "2026-06-29T10:00:00.000Z",
          status: "in_transit",
          location: "Leipzig, DE",
        },
      ],
    },
  },
];

const SAMPLE_CUSTOMERS: readonly MockCustomer[] = [
  {
    customerId: "cus_ada",
    tenantId: "ten_acme",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    tier: "vip",
    lifetimeOrders: 12,
    createdAt: "2025-01-15T00:00:00.000Z",
  },
  {
    customerId: "cus_bob",
    tenantId: "ten_globex",
    displayName: "Bob Stone",
    email: "bob@example.com",
    tier: "standard",
    lifetimeOrders: 2,
    createdAt: "2026-05-20T00:00:00.000Z",
  },
];

/** Default seeded dataset for the first-party tools and their tests. */
export function createSampleCommerceDataset(): MockCommerceDataset {
  return createCommerceDataset(SAMPLE_ORDERS, SAMPLE_CUSTOMERS);
}
