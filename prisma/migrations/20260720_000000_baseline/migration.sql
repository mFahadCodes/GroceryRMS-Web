-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "pin" TEXT,
    "role_id" INTEGER NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "last_login_at" DATETIME,
    CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "module" TEXT,
    "description" TEXT
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "access_level" INTEGER NOT NULL DEFAULT 5,

    PRIMARY KEY ("role_id", "permission_id"),
    CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "user_id" INTEGER NOT NULL,
    "terminal_id" INTEGER,
    "login_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout_at" DATETIME,
    "ip_address" TEXT,
    CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "user_sessions_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "table_name" TEXT,
    "record_id" INTEGER,
    "old_values" TEXT,
    "new_values" TEXT,
    "ip_address" TEXT,
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" INTEGER,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "image_path" TEXT,
    CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "base_price" BIGINT NOT NULL,
    "cost_price" BIGINT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "tax_rate_id" INTEGER,
    "image_path" TEXT,
    "max_discount" BIGINT NOT NULL DEFAULT 0,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "unit_of_measure" TEXT NOT NULL DEFAULT 'ea',
    "is_weighted" BOOLEAN NOT NULL DEFAULT false,
    "current_stock" DECIMAL NOT NULL DEFAULT 0,
    "reorder_level" DECIMAL NOT NULL DEFAULT 0,
    "expiry_date" DATETIME,
    "batch_number" TEXT,
    "supplier_id" INTEGER,
    CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "products_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price_override" BIGINT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "is_inclusive" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "discounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL NOT NULL,
    "min_order_amount" BIGINT NOT NULL DEFAULT 0,
    "max_discount_amount" BIGINT NOT NULL DEFAULT 0,
    "start_date" DATETIME,
    "end_date" DATETIME,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "code" TEXT
);

-- CreateTable
CREATE TABLE "promotion_bundles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deal_price" BIGINT NOT NULL,
    "original_price" BIGINT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "image_path" TEXT,
    "category_id" INTEGER,
    CONSTRAINT "promotion_bundles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "promotion_bundle_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "bundle_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "promotion_bundle_items_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "promotion_bundles" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "promotion_bundle_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "product_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "cost_amount" BIGINT,
    "reference" TEXT,
    "notes" TEXT,
    "user_id" INTEGER,
    CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "supplier_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "ordered_at" DATETIME,
    "expected_delivery" DATETIME,
    "received_at" DATETIME,
    "notes" TEXT,
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "purchase_order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity_ordered" DECIMAL NOT NULL,
    "quantity_received" DECIMAL NOT NULL DEFAULT 0,
    "unit_cost" BIGINT NOT NULL,
    CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_takes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'InProgress',
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    "notes" TEXT,
    "user_id" INTEGER,
    CONSTRAINT "stock_takes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_take_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stock_take_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "expected_qty" DECIMAL NOT NULL,
    "counted_qty" DECIMAL NOT NULL,
    CONSTRAINT "stock_take_items_stock_take_id_fkey" FOREIGN KEY ("stock_take_id") REFERENCES "stock_takes" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "stock_take_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order_number" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "customer_id" INTEGER,
    "cashier_id" INTEGER,
    "sub_total" BIGINT NOT NULL DEFAULT 0,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,
    "discount_amount" BIGINT NOT NULL DEFAULT 0,
    "service_charge" BIGINT NOT NULL DEFAULT 0,
    "grand_total" BIGINT NOT NULL DEFAULT 0,
    "adjustment" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "void_reason" TEXT,
    "approved_by_user_id" INTEGER,
    "is_synced" BOOLEAN NOT NULL DEFAULT false,
    "terminal_id" INTEGER,
    "shift_id" INTEGER,
    "tax_rate_id" INTEGER,
    "delivery_slot" DATETIME,
    "invoice_number" TEXT,
    "original_order_id" INTEGER,
    "driver_id" INTEGER,
    "delivered_at" DATETIME,
    "delivery_address" TEXT,
    CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "orders_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "employees" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "orders_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "orders_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "orders_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "orders_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "orders_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "orders_original_order_id_fkey" FOREIGN KEY ("original_order_id") REFERENCES "orders" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "variant_id" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,
    "notes" TEXT,
    "void_reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "weight_kg" DECIMAL,
    "scanned_barcode" TEXT,
    CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order_id" INTEGER NOT NULL,
    "payment_method_id" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "tendered_amount" BIGINT NOT NULL,
    "change_amount" BIGINT NOT NULL,
    "reference_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Paid',
    CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "is_digital" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "customers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "loyalty_points" BIGINT NOT NULL DEFAULT 0,
    "total_spent" BIGINT NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'Regular',
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "customer_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT,
    "area" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "customer_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "points" BIGINT NOT NULL,
    "order_id" INTEGER,
    "description" TEXT,
    CONSTRAINT "loyalty_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "loyalty_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "balance" BIGINT NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "supplier_expenses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "supplier_id" INTEGER,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "expense_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoice_number" TEXT,
    "category" TEXT,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "paid_at" DATETIME,
    "notes" TEXT,
    CONSTRAINT "supplier_expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "employees" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "cnic" TEXT,
    "address" TEXT,
    "emergency_contact" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Floor',
    "employment_type" TEXT NOT NULL,
    "designation" TEXT,
    "joining_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaving_date" DATETIME,
    "basic_salary" BIGINT NOT NULL DEFAULT 0,
    "allowances" BIGINT NOT NULL DEFAULT 0,
    "deductions" BIGINT NOT NULL DEFAULT 0,
    "user_id" INTEGER,
    CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "employee_id" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "basic_salary" BIGINT NOT NULL,
    "allowances" BIGINT NOT NULL DEFAULT 0,
    "deductions" BIGINT NOT NULL DEFAULT 0,
    "bonus" BIGINT NOT NULL DEFAULT 0,
    "advance" BIGINT NOT NULL DEFAULT 0,
    "net_salary" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "paid_at" DATETIME,
    "notes" TEXT,
    "expense_id" INTEGER,
    CONSTRAINT "payrolls_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "user_id" INTEGER NOT NULL,
    "terminal_id" INTEGER,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" DATETIME,
    "opening_balance" BIGINT NOT NULL,
    "closing_balance" BIGINT NOT NULL DEFAULT 0,
    "expected_balance" BIGINT NOT NULL DEFAULT 0,
    "discrepancy" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "shifts_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cash_drawer_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "shift_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "description" TEXT,
    "order_id" INTEGER,
    "user_id" INTEGER,
    CONSTRAINT "cash_drawer_logs_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "cash_drawer_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "cash_drawer_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_summaries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "date" DATETIME NOT NULL,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_revenue" BIGINT NOT NULL DEFAULT 0,
    "total_tax" BIGINT NOT NULL DEFAULT 0,
    "total_discount" BIGINT NOT NULL DEFAULT 0,
    "cash_sales" BIGINT NOT NULL DEFAULT 0,
    "card_sales" BIGINT NOT NULL DEFAULT 0,
    "digital_sales" BIGINT NOT NULL DEFAULT 0,
    "voided_orders" INTEGER NOT NULL DEFAULT 0,
    "peak_hour" INTEGER NOT NULL DEFAULT 0,
    "terminal_id" INTEGER,
    CONSTRAINT "daily_summaries_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals" ("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "terminals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "machine_id" TEXT,
    "last_active_at" DATETIME
);

-- CreateTable
CREATE TABLE "printers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "connection_type" TEXT NOT NULL,
    "address" TEXT,
    "paper_width" INTEGER NOT NULL DEFAULT 80,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "system_printer_name" TEXT
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "data_type" TEXT,
    "description" TEXT,
    "setting_group" TEXT
);

-- CreateTable
CREATE TABLE "sync_queue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "table_name" TEXT NOT NULL,
    "record_id" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "products_category_id_is_active_idx" ON "products"("category_id", "is_active");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_is_synced_idx" ON "orders"("is_synced");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_employee_id_year_month_key" ON "payrolls"("employee_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "daily_summaries_date_terminal_id_key" ON "daily_summaries"("date", "terminal_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings"("key");

-- CreateIndex
CREATE INDEX "sync_queue_status_created_at_idx" ON "sync_queue"("status", "created_at");
